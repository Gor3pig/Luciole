#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later

# Runs inside the private D-Bus session started by soak.sh. Do not call directly.
set -u

WORK=$1
LOG_FILE=$2
UUID=$3
. "$(dirname "$0")/lib.sh"
# Growth allowed for what the shell keeps alive after a garbage collection (see heap_bytes in
# lib.sh), between the end of the warm-up and the end of the run: about 370 openings, so this
# catches a leak of a few kB per opening. The resident size is printed for information only: it
# is a sawtooth (the collector runs late), which made it useless as a pass/fail criterion.
MAX_HEAP_GROWTH=1048576

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
WARM_UP=$((TOTAL / 5))
HEAP_START=""
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
    # What the code keeps alive is measured after warm-up, once caches and the like are built.
    [ "$n" -eq "$WARM_UP" ] && HEAP_START=$(heap_bytes)
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

HEAP_END=$(heap_bytes)
if [ -n "$HEAP_START" ] && [ -n "$HEAP_END" ]; then
    echo "JavaScript heap after garbage collection: ${HEAP_START} bytes after warm-up, ${HEAP_END} bytes at the end, growth $((HEAP_END - HEAP_START)) bytes (limit ${MAX_HEAP_GROWTH})"
    [ $((HEAP_END - HEAP_START)) -le "$MAX_HEAP_GROWTH" ] || fail "what the shell keeps alive kept growing"
else
    fail "the JavaScript heap could not be measured"
fi

SAMPLES=$(wc -l <"$LOG.rss")
if [ "$SAMPLES" -ge 4 ]; then
    MIDDLE=$(sed -n "$(((SAMPLES + 1) / 2))p" "$LOG.rss")
    LAST=$(tail -n 1 "$LOG.rss")
    echo "memory samples (kB): $(tr '\n' ' ' <"$LOG.rss")"
    echo "resident memory growth over the second half (information only): $((LAST - MIDDLE)) kB"
fi
echo "PASS"
