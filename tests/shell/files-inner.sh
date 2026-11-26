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

# Categories: chips under the field, Ctrl+0/1/2 and a click choose where the search goes.
# chip_info: "<number of chips> <index of the checked one>" ("hidden" when the row is not shown).
chip_info() {
    shell_eval "(function find(a) { if ((a.style_class || '').includes('luciole-chips')) { const k = a.get_children(); return a.visible ? k.length + ' ' + k.findIndex(c => c.checked) : 'hidden'; } for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage)"
}
# chip_center <index>: where to click to hit that chip.
chip_center() {
    shell_eval "(function find(a) { if ((a.style_class || '').includes('luciole-chips')) { const c = a.get_children()[$1]; const [x, y] = c.get_transformed_position(); const [w, h] = c.get_transformed_size(); return Math.round(x + w / 2) + ' ' + Math.round(y + h / 2); } for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage)"
}
empty_hint_shown() {
    shell_eval "(function find(a) { if ((a.style_class || '').includes('luciole-empty-hint')) return String(a.visible); for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage)"
}
# wait_last <regex>: the most recent "results:" line of the log matches it (polls for 4 s).
wait_last() {
    i=0
    while [ "$i" -lt 80 ]; do
        grep -F '[Luciole] results:' "$LOG" | tail -n 1 | grep -qE "$1" && return 0
        sleep 0.05
        i=$((i + 1))
    done
    return 1
}
last_results() { grep -F '[Luciole] results:' "$LOG" | tail -n 1 | sed 's/.*results: //'; }

[ "$(chip_info)" = "3 0" ] || fail "categories: expected 3 chips with the first checked, got '$(chip_info)'"
echo "ok: the chips are there (All, Applications, Files), All is chosen"
chord Control_L+2
wait_last 'results: 1 first=Facture m.* query=factu' || fail "Ctrl+2 did not restrict to files (last: $(last_results))"
[ "$(chip_info)" = "3 2" ] || fail "Ctrl+2 did not check the Files chip ('$(chip_info)')"
chord Control_L+1
wait_last 'results: 1 first=Facture Express query=factu' || fail "Ctrl+1 did not restrict to applications (last: $(last_results))"
[ "$(chip_info)" = "3 1" ] || fail "Ctrl+1 did not check the Applications chip ('$(chip_info)')"
chord Control_L+0
wait_last 'results: 2 first=Facture Express query=factu' || fail "Ctrl+0 did not bring everything back (last: $(last_results))"
[ "$(chip_info)" = "3 0" ] || fail "Ctrl+0 did not check the All chip ('$(chip_info)')"
echo "ok: Ctrl+2 files only, Ctrl+1 applications only, Ctrl+0 everything"
chord Control_L+3
sleep 0.4
[ "$(chip_info)" = "3 0" ] || fail "Ctrl+3 changed the category although there is no third source ('$(chip_info)')"
[ "$(wc -l <"$WORK/closed-count" 2>/dev/null || echo 0)" = 0 ] || true
echo "ok: a digit with no source behind it does nothing"

CLOSED_BEFORE=$(grep -cF "[Luciole] closed" "$LOG")
set -- $(chip_center 2)
pointer "$1" "$2"
sleep 0.3
click
wait_last 'results: 1 first=Facture m.* query=factu' || fail "a click on the Files chip did not restrict to files (last: $(last_results))"
[ "$(chip_info)" = "3 2" ] || fail "the click did not check the Files chip ('$(chip_info)')"
[ "$(grep -cF "[Luciole] closed" "$LOG")" = "$CLOSED_BEFORE" ] || fail "a click on a chip closed the launcher"
typed ab
sleep 0.3
[ "$(entry_text_length)" = 7 ] || fail "after a click on a chip the keyboard does not reach the field ($(entry_text_length) characters, expected 7)"
clear_entry 2
echo "ok: a click on a chip works, keeps the window open and the keyboard in the field"

clear_entry 5
sleep 0.5
[ "$(empty_hint_shown)" = true ] || fail "an empty field with Files chosen shows no hint about typing"
typed quok
wait_last 'results: 3 first=.*query=quok' || fail "files not found with the Files category (last: $(last_results))"
[ "$(empty_hint_shown)" = false ] || fail "the empty-field hint stays once something is typed"
chord Control_L+1
wait_last 'results: 0 first=- query=quok' || fail "applications only should find no quokka (last: $(last_results))"
[ "$(empty_hint_shown)" = false ] || fail "the empty-field hint shows although something is typed and nothing was found"
echo "ok: the empty-field hint shows only for an empty field; a category finds only its own results"

# Every opening starts on All again.
escape
sleep 0.2
escape
wait_log "[Luciole] closed" $((CLOSED_BEFORE + 1)) || fail "the launcher did not close"
sleep 0.4
combo
wait_log "[Luciole] opened" 2 || fail "the launcher did not reopen"
sleep 0.4
[ "$(chip_info)" = "3 0" ] || fail "reopening did not start on All ('$(chip_info)')"
[ "$(empty_hint_shown)" = false ] || fail "the hint shows on a fresh opening"
echo "ok: reopening starts on All"
typed quok
wait_last 'results: 3 first=.*query=quok' || fail "the search after reopening still restricted (last: $(last_results))"
clear_entry 4

# A French keyboard: the digit row types & é " ... unshifted, the shortcuts must still be the keys
# in the positions of 1, 2, 3 (read by position, not by symbol).
gsettings set org.gnome.desktop.input-sources sources "[('xkb', 'fr')]" || fail "could not set the French layout"
i=0
while [ "$i" -lt 40 ]; do
    send "code 3"
    sleep 0.15
    [ "$(entry_text_length)" = 1 ] && break
    i=$((i + 1))
done
FIELD=$(shell_eval "(function find(a) { if ((a.style_class || '').includes('luciole-entry') && a.get_text) return a.get_text(); for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage)")
case "$FIELD" in
    "2") fail "the test shell did not switch to the French layout (the key typed '2')" ;;
    "") fail "the key typed nothing" ;;
esac
echo "ok: the French layout is active (the key in the position of 2 types '$FIELD')"
clear_entry 1
chord Control_L+0
sleep 0.3
send "code Control_L+3"
sleep 0.5
[ "$(chip_info)" = "3 2" ] || fail "Ctrl and the key in the position of 2 did not choose Files on a French keyboard ('$(chip_info)')"
send "code Control_L+2"
sleep 0.5
[ "$(chip_info)" = "3 1" ] || fail "Ctrl and the key in the position of 1 did not choose Applications on a French keyboard ('$(chip_info)')"
echo "ok: on a French keyboard the shortcuts are the digit-row keys, whatever they type"
gsettings reset org.gnome.desktop.input-sources sources
chord Control_L+0
sleep 0.3

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
