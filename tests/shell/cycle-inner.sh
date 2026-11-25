#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later
# Runs inside the private D-Bus session started by cycle.sh. Do not call directly.
set -u

CYCLES=$1
LOG_FILE=$2
UUID=$3
. "$(dirname "$0")/lib.sh"

start_shell "$LOG_FILE"
wait_for_extension
echo "extension discovered, initial state $(ext_state)"

WARM_UP=$((CYCLES / 4))
HEAP_START=""
n=1
while [ "$n" -le "$CYCLES" ]; do
    ext_call EnableExtension "$UUID" >/dev/null
    wait_ext_state "$STATE_ENABLED" || fail "cycle $n: not ENABLED (state=$(ext_state))"
    ext_call DisableExtension "$UUID" >/dev/null
    wait_ext_state "$STATE_DISABLED" || fail "cycle $n: not DISABLED (state=$(ext_state))"
    kill -0 "$SHELL_PID" 2>/dev/null || fail "cycle $n: the shell died"
    [ "$n" -eq "$WARM_UP" ] && HEAP_START=$(heap_bytes)
    [ $((n % 10)) -eq 0 ] && rss_kb >>"$LOG.rss"
    n=$((n + 1))
done

HEAP_END=$(heap_bytes)
if [ -n "$HEAP_START" ] && [ -n "$HEAP_END" ]; then
    echo "JavaScript heap after garbage collection: ${HEAP_START} bytes after warm-up, ${HEAP_END} bytes at the end"
    echo "heap_growth=$((HEAP_END - HEAP_START))"
fi
LAST_RSS=$(rss_kb)
echo "$CYCLES enable/disable cycles done, shell alive"
# One sample every 10 cycles. A shell warms up (caches, JavaScript heap) before its
# memory settles, so a total growth says little. A leak keeps growing, so what counts
# is the growth in the second half of the run, once the curve should be flat.
SAMPLES=$(wc -l <"$LOG.rss")
if [ "$SAMPLES" -ge 4 ]; then
    MIDDLE=$(sed -n "$(((SAMPLES + 1) / 2))p" "$LOG.rss")
    echo "resident memory samples (kB): $(tr '\n' ' ' <"$LOG.rss")"
    echo "resident growth (information only): $((LAST_RSS - MIDDLE)) kB"
fi

ERRORS=$(grep -ciE "$EXTENSION_ERROR_PATTERN" "$LOG" || true)
echo "log lines mentioning an error about the extension or a disposed object: $ERRORS"
if [ "$ERRORS" -gt 0 ]; then
    grep -iE "$EXTENSION_ERROR_PATTERN" "$LOG" | head -20
    fail "errors found in the shell log"
fi

echo "PASS"
