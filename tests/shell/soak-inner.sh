#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later

# Runs inside the private D-Bus session started by soak.sh. Do not call directly.
set -u

WORK=$1
LOG_FILE=$2
UUID=$3
. "$(dirname "$0")/lib.sh"
# Growth allowed over the second half of the run, in kB. The shell's memory is a sawtooth
# (garbage collection), so this only catches leaks of roughly 100 kB per opening or more;
# finer ones are the job of the differential tests (cycle.sh, openclose.sh).
MAX_GROWTH_KB=30720

start_shell "$LOG_FILE"
wait_for_extension
gsettings set org.gnome.shell.extensions.luciole debug-timings true || fail "could not set debug-timings"
apps_only
# SOAK_CONTROL=1: same actions without the extension, to measure the shell's own memory noise.
if [ -z "${SOAK_CONTROL:-}" ]; then
    ext_call EnableExtension "$UUID" >/dev/null
    wait_ext_state "$STATE_ENABLED" || fail "extension not ENABLED (state=$(ext_state))"
fi
start_keys

count() { grep -c "\[Luciole\] $1" "$LOG" || true; }

TOTAL=$(wc -l <"$WORK/actions.txt")
n=0
while IFS= read -r action; do
    case "$action" in
        combo) combo ;;
        escape) escape ;;
        enter-test)
            # Wait for the result to be shown (the search is debounced), then validate it.
            before=$(grep -c '\[Luciole\] results: 1 first=Luciole Test Marker' "$LOG" || true)
            typed zzmark
            waited=0
            while [ "$(grep -c '\[Luciole\] results: 1 first=Luciole Test Marker' "$LOG" || true)" = "$before" ] && [ "$waited" -lt 40 ]; do
                sleep 0.05
                waited=$((waited + 1))
            done
            press Return
            ;;
        *) send "$action" ;;
    esac
    n=$((n + 1))
    if [ $((n % 250)) -eq 0 ]; then
        kill -0 "$SHELL_PID" 2>/dev/null || fail "the shell died after $n actions"
        rss_kb >>"$LOG.rss"
    fi
done <"$WORK/actions.txt"
echo "actions: $n of $TOTAL done, shell alive"

if [ -n "${SOAK_CONTROL:-}" ]; then
    echo "memory samples (kB): $(tr '\n' ' ' <"$LOG.rss")"
    echo "PASS"
    exit 0
fi

# Bring everything back to a known state, then check the invariants.
escape
escape
escape
sleep 1
OPENED=$(count opened)
CLOSED=$(count closed)
echo "launcher opened $OPENED times, closed $CLOSED times"
[ "$OPENED" = "$CLOSED" ] || fail "every opening must be closed (opened $OPENED, closed $CLOSED)"

# The keyboard must not be stuck: the shortcut opens the launcher again, Escape closes it.
combo
i=0
until [ "$(count opened)" -gt "$OPENED" ]; do
    i=$((i + 1))
    [ "$i" -gt 100 ] && fail "the launcher no longer opens after the run"
    sleep 0.05
done
escape
i=0
until [ "$(count closed)" -gt "$CLOSED" ]; do
    i=$((i + 1))
    [ "$i" -gt 100 ] && fail "the launcher no longer closes after the run"
    sleep 0.05
done
echo "ok: the launcher still opens and closes, the keyboard is free"

ERRORS=$(grep -ciE "$EXTENSION_ERROR_PATTERN" "$LOG" || true)
echo "log lines mentioning an error about the extension or a disposed object: $ERRORS"
if [ "$ERRORS" -gt 0 ]; then
    grep -iE "$EXTENSION_ERROR_PATTERN" "$LOG" | head -10
    fail "errors found in the shell log"
fi

if [ -n "${SOAK_GC:-}" ]; then
    echo "rss before gc: $(rss_kb) kB"
    for _ in 1 2 3; do
        gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval 'global.run_gc(); 1' >/dev/null 2>&1
        sleep 1
    done
    echo "rss after gc:  $(rss_kb) kB"
    echo "eval check: $(gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval '1+1' 2>&1)"
fi

SAMPLES=$(wc -l <"$LOG.rss")
if [ "$SAMPLES" -ge 4 ]; then
    MIDDLE=$(sed -n "$(((SAMPLES + 1) / 2))p" "$LOG.rss")
    LAST=$(tail -n 1 "$LOG.rss")
    echo "memory samples (kB): $(tr '\n' ' ' <"$LOG.rss")"
    echo "memory growth over the second half: $((LAST - MIDDLE)) kB (limit $MAX_GROWTH_KB kB)"
    [ $((LAST - MIDDLE)) -le "$MAX_GROWTH_KB" ] || fail "memory kept growing"
fi
echo "PASS"
