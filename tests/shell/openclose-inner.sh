#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later
# Runs inside the private D-Bus session started by openclose.sh. Do not call directly.
set -u

NAME=$1
ENABLE=$2
CYCLES=$3
UUID=$4
LOG_FILE=$5
. "$(dirname "$0")/lib.sh"

SCHEMA=org.gnome.shell.extensions.luciole
# Budget for the synchronous part of opening the launcher (ms). The first open
# builds the actors, so it is the slowest.
OPEN_BUDGET_MS=50

start_shell "$LOG_FILE"
wait_for_extension

if [ "$ENABLE" = 1 ]; then
    gsettings set "$SCHEMA" debug-timings true || fail "could not set debug-timings"
    apps_only
    ext_call EnableExtension "$UUID" >/dev/null
    wait_ext_state "$STATE_ENABLED" || fail "extension not ENABLED (state=$(ext_state))"
fi

start_keys
count() { grep -c "\[Luciole\] $1" "$LOG" || true; }
wait_count() { # wait_count <message> <at least n>: polls for up to 5 s
    i=0
    while [ "$i" -lt 100 ]; do
        [ "$(count "$1")" -ge "$2" ] && return 0
        sleep 0.05
        i=$((i + 1))
    done
    return 1
}

n=1
while [ "$n" -le "$CYCLES" ]; do
    combo
    if [ "$ENABLE" = 1 ]; then
        wait_count 'opened' "$n" || fail "cycle $n: the launcher did not open"
        escape
        wait_count 'closed' "$n" || fail "cycle $n: the launcher did not close on Escape"
    else
        sleep 0.15
        escape
    fi
    kill -0 "$SHELL_PID" 2>/dev/null || fail "cycle $n: the shell died"
    [ $((n % 10)) -eq 0 ] && rss_kb >>"$LOG.rss"
    n=$((n + 1))
done

LAST_RSS=$(rss_kb)
echo "$CYCLES open/close cycles done, shell alive"
# One sample every 10 cycles. A shell warms up (caches, JavaScript heap) before its
# memory settles, so a total growth says little. A leak keeps growing, so what counts
# is the growth in the second half of the run, once the curve should be flat.
SAMPLES=$(wc -l <"$LOG.rss")
if [ "$SAMPLES" -ge 4 ]; then
    MIDDLE=$(sed -n "$(((SAMPLES + 1) / 2))p" "$LOG.rss")
    echo "resident memory samples (kB): $(tr '\n' ' ' <"$LOG.rss")"
    echo "growth_kb=$((LAST_RSS - MIDDLE))"
fi

if [ "$ENABLE" = 1 ]; then
    # Timing of the synchronous part of opening.
    grep 'perf open:' "$LOG" | sed -n 's/.*perf open: \([0-9.]*\) ms.*/\1/p' >"$LOG.open"
    FIRST=$(head -n 1 "$LOG.open")
    MAX=$(sort -n "$LOG.open" | tail -n 1)
    echo "opening time (handler only, not the compositor frame): first ${FIRST} ms, worst ${MAX} ms, budget ${OPEN_BUDGET_MS} ms"
    awk -v max="$MAX" -v budget="$OPEN_BUDGET_MS" 'BEGIN { exit !(max + 0 <= budget + 0) }' ||
        fail "opening is slower than the ${OPEN_BUDGET_MS} ms budget"

    # Disabling the extension while the launcher is open must release the keyboard
    # and free the shortcut; re-enabling must then work normally.
    OPENED=$(count opened)
    combo
    wait_count 'opened' $((OPENED + 1)) || fail "the launcher did not open before the disable test"
    ext_call DisableExtension "$UUID" >/dev/null
    wait_ext_state "$STATE_DISABLED" || fail "disable while open: not DISABLED (state=$(ext_state))"
    OPENED=$(count opened)
    combo
    sleep 0.5
    [ "$(count opened)" = "$OPENED" ] || fail "the shortcut still works after the extension was disabled"
    echo "disable while open: clean, and the shortcut is freed"
    ext_call EnableExtension "$UUID" >/dev/null
    wait_ext_state "$STATE_ENABLED" || fail "re-enable: not ENABLED (state=$(ext_state))"
    CLOSED=$(count closed)
    combo
    wait_count 'opened' $((OPENED + 1)) || fail "the launcher did not open after re-enabling"
    escape
    wait_count 'closed' $((CLOSED + 1)) || fail "the launcher did not close after re-enabling"

    # Screen lock: an open launcher closes, and the shortcut does nothing while locked.
    LOCK_HINT_BEFORE=$(busctl get-property org.freedesktop.login1 /org/freedesktop/login1/session/auto \
        org.freedesktop.login1.Session LockedHint 2>&1)
    OPENED=$(count opened)
    CLOSED=$(count closed)
    combo
    wait_count 'opened' $((OPENED + 1)) || fail "the launcher did not open before the lock test"
    gdbus call --session --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver \
        --method org.gnome.ScreenSaver.Lock >/dev/null || fail "could not lock the screen"
    wait_count 'closed' $((CLOSED + 1)) || fail "the launcher stayed open after the screen locked"
    OPENED=$(count opened)
    combo
    sleep 1
    [ "$(count opened)" = "$OPENED" ] || fail "the launcher opened on a locked screen"
    echo "screen lock: the open launcher closed, and the shortcut is ignored while locked"
    # The nested shell told logind that its session is locked: put it back.
    busctl call org.freedesktop.login1 /org/freedesktop/login1/session/auto \
        org.freedesktop.login1.Session SetLockedHint b false >/dev/null 2>&1 || true
    echo "logind LockedHint before: ${LOCK_HINT_BEFORE}; after restore: $(busctl get-property org.freedesktop.login1 \
        /org/freedesktop/login1/session/auto org.freedesktop.login1.Session LockedHint 2>&1)"
fi

ERRORS=$(grep -ciE "$EXTENSION_ERROR_PATTERN" "$LOG" || true)
echo "log lines mentioning an error about the extension or a disposed object: $ERRORS"
if [ "$ERRORS" -gt 0 ]; then
    grep -iE "$EXTENSION_ERROR_PATTERN" "$LOG" | head -20
    fail "errors found in the shell log"
fi

echo "PASS"
