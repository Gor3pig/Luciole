#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later
# Runs inside the private D-Bus session started by files.sh. Do not call directly.
set -u

WORK=$1
LOG_FILE=$2
UUID=luciole@gor3pig.github.io
. "$(dirname "$0")/lib.sh"
# Budget for the time from a keystroke to the file results being shown (ms), in this VM.
FILES_BUDGET_MS=400

start_shell "$LOG_FILE"
start_index_service
wait_for_extension
gsettings set org.gnome.shell.extensions.luciole debug-timings true || fail "could not set debug-timings"
ext_call EnableExtension "$UUID" >/dev/null
wait_ext_state "$STATE_ENABLED" || fail "extension not ENABLED (state=$(ext_state))"
start_keys

wait_log() { # wait_log <fixed text> [count] [seconds]
    i=0
    while [ "$i" -lt $((${3:-5} * 20)) ]; do
        [ "$(grep -cF "$1" "$LOG")" -ge "${2:-1}" ] && return 0
        sleep 0.05
        i=$((i + 1))
    done
    return 1
}
clear_entry() {
    n=$1
    while [ "$n" -gt 0 ]; do
        press BackSpace
        n=$((n - 1))
    done
}

wait_log "search ready: apps, files" || fail "both providers did not start"
combo
wait_log "[Luciole] opened" || fail "the launcher did not open"

# Three visible quokka files (the hidden folder and node_modules are excluded): 3 results,
# never 4 or more. No installed application is called "quokka", so the count does not
# depend on the machine.
typed quok
wait_log "results: 3 first=" 1 8 || fail "expected 3 results for 'quok'; saw: $(grep -F 'query=quok' "$LOG" | tail -n 2 | tr '\n' '|')"
grep -E "results: 3 first=[Qq]uokka.* query=quok" "$LOG" >/dev/null || fail "the best result is not one of the quokka files"
if grep -E "results: [4-9] .*query=quok" "$LOG" >/dev/null; then
    fail "hidden or excluded files were shown"
fi
echo "ok: files are found, hidden and excluded folders are left out"
clear_entry 4

# Applications and files side by side, applications first.
typed factu
wait_log "results: 2 first=Facture Express query=factu" 1 8 || fail "expected the application and the file for 'factu'; saw: $(grep -F 'query=factu' "$LOG" | tail -n 2 | tr '\n' '|')"
echo "ok: an application and a file for the same word are both shown"

# Tab moves between sections: from the top hit (the application) to the files, and back with Shift+Tab.
press Tab
wait_log "selected: files:file:///home/tester/Documents/Facture" 1 || fail "Tab did not move to the files section"
press ISO_Left_Tab
wait_log "selected: " 2 || fail "Shift+Tab did not select anything"
grep 'selected: ' "$LOG" | tail -n 1 | grep -qF "selected: apps:luciole-test-facture.desktop" || fail "Shift+Tab did not come back to the top hit"
echo "ok: Tab and Shift+Tab move between sections"

# Opening a file is covered by the unit tests, with an injected opener: the files here do not exist.
clear_entry 5
typed quok
wait_log "results: 3 first=" 2 || fail "results did not come back"

grep 'perf query to final results:' "$LOG" | sed -n 's/.*final results: \([0-9.]*\) ms.*/\1/p' >"$LOG.q"
[ -s "$LOG.q" ] || fail "no timing was recorded for the final results"
WORST=$(sort -n "$LOG.q" | tail -n 1)
echo "keystroke to complete results, files included, 50 ms debounce included (this VM): worst ${WORST} ms, budget ${FILES_BUDGET_MS} ms"
awk -v w="$WORST" -v b="$FILES_BUDGET_MS" 'BEGIN { exit !(w + 0 <= b + 0) }' || fail "results took longer than ${FILES_BUDGET_MS} ms"

ERRORS=$(grep -ciE "$EXTENSION_ERROR_PATTERN" "$LOG" || true)
echo "log lines mentioning an error about the extension: $ERRORS"
if [ "$ERRORS" -gt 0 ]; then
    grep -iE "$EXTENSION_ERROR_PATTERN" "$LOG" | head -10
    fail "errors found in the shell log"
fi
echo "PASS"
