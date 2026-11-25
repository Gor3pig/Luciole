#!/bin/sh
# Runs inside the private D-Bus session started by cycle.sh. Do not call directly.
set -u

CYCLES=$1
LOG=$2
UUID=$3
DEST=org.gnome.Shell.Extensions
OBJ=/org/gnome/Shell/Extensions
STATE_ENABLED=1.0
STATE_DISABLED=2.0

gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x720 >"$LOG" 2>&1 &
SHELL_PID=$!
trap 'kill "$SHELL_PID" 2>/dev/null; wait "$SHELL_PID" 2>/dev/null' EXIT

call() {
    method=$1
    shift
    gdbus call --session --dest "$DEST" --object-path "$OBJ" --method "$DEST.$method" "$@" 2>&1
}

state() {
    call GetExtensionInfo "$UUID" | sed -n "s/.*'state': <\([0-9.]*\)>.*/\1/p"
}

rss_kb() {
    awk '/^VmRSS:/ {print $2}' "/proc/$SHELL_PID/status"
}

# wait_state <wanted> : polls for up to 10 s.
wait_state() {
    i=0
    while [ "$i" -lt 100 ]; do
        [ "$(state)" = "$1" ] && return 0
        sleep 0.1
        i=$((i + 1))
    done
    return 1
}

fail() {
    echo "FAIL: $1"
    echo "---- last lines of the shell log ----"
    tail -n 25 "$LOG"
    exit 1
}

# Wait for the shell to discover the extension (it answers with a state).
i=0
until [ -n "$(state)" ]; do
    i=$((i + 1))
    [ "$i" -gt 200 ] && fail "the shell never listed $UUID"
    kill -0 "$SHELL_PID" 2>/dev/null || fail "the shell exited during startup"
    sleep 0.1
done
echo "extension discovered, initial state $(state)"

BASE_RSS=
n=1
while [ "$n" -le "$CYCLES" ]; do
    call EnableExtension "$UUID" >/dev/null
    wait_state "$STATE_ENABLED" || fail "cycle $n: not ENABLED (state=$(state))"
    call DisableExtension "$UUID" >/dev/null
    wait_state "$STATE_DISABLED" || fail "cycle $n: not DISABLED (state=$(state))"
    kill -0 "$SHELL_PID" 2>/dev/null || fail "cycle $n: the shell died"
    [ "$n" -eq 10 ] && BASE_RSS=$(rss_kb)
    [ $((n % 10)) -eq 0 ] && echo "cycle $n: resident memory $(rss_kb) kB"
    n=$((n + 1))
done

LAST_RSS=$(rss_kb)
echo "$CYCLES enable/disable cycles done, shell alive"
if [ -n "$BASE_RSS" ]; then
    echo "resident memory: ${BASE_RSS} kB after cycle 10, ${LAST_RSS} kB at the end"
    echo "growth_kb=$((LAST_RSS - BASE_RSS))"
fi

ERRORS=$(grep -ciE 'JS ERROR|luciole.*(error|critical|warning)|already disposed' "$LOG" || true)
echo "log lines mentioning an error about the extension or a disposed object: $ERRORS"
if [ "$ERRORS" -gt 0 ]; then
    grep -iE 'JS ERROR|luciole|already disposed' "$LOG" | head -20
    fail "errors found in the shell log"
fi

echo "PASS"
