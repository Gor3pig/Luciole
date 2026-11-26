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

[ "$(chip_info)" = "4 0" ] || fail "categories: expected 3 chips with the first checked, got '$(chip_info)'"
echo "ok: the chips are there (All, Applications, Files, Calculator), All is chosen"
chord Control_L+2
wait_last 'results: 1 first=Facture m.* query=factu' || fail "Ctrl+2 did not restrict to files (last: $(last_results))"
[ "$(chip_info)" = "4 2" ] || fail "Ctrl+2 did not check the Files chip ('$(chip_info)')"
chord Control_L+1
wait_last 'results: 1 first=Facture Express query=factu' || fail "Ctrl+1 did not restrict to applications (last: $(last_results))"
[ "$(chip_info)" = "4 1" ] || fail "Ctrl+1 did not check the Applications chip ('$(chip_info)')"
chord Control_L+0
wait_last 'results: 2 first=Facture Express query=factu' || fail "Ctrl+0 did not bring everything back (last: $(last_results))"
[ "$(chip_info)" = "4 0" ] || fail "Ctrl+0 did not check the All chip ('$(chip_info)')"
echo "ok: Ctrl+2 files only, Ctrl+1 applications only, Ctrl+0 everything"
chord Control_L+4
sleep 0.4
[ "$(chip_info)" = "4 0" ] || fail "Ctrl+4 changed the category although there is no fourth source ('$(chip_info)')"
[ "$(wc -l <"$WORK/closed-count" 2>/dev/null || echo 0)" = 0 ] || true
echo "ok: a digit with no source behind it does nothing"

CLOSED_BEFORE=$(grep -cF "[Luciole] closed" "$LOG")
set -- $(chip_center 2)
pointer "$1" "$2"
sleep 0.3
click
wait_last 'results: 1 first=Facture m.* query=factu' || fail "a click on the Files chip did not restrict to files (last: $(last_results))"
[ "$(chip_info)" = "4 2" ] || fail "the click did not check the Files chip ('$(chip_info)')"
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
[ "$(chip_info)" = "4 0" ] || fail "reopening did not start on All ('$(chip_info)')"
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
[ "$(chip_info)" = "4 2" ] || fail "Ctrl and the key in the position of 2 did not choose Files on a French keyboard ('$(chip_info)')"
send "code Control_L+2"
sleep 0.5
[ "$(chip_info)" = "4 1" ] || fail "Ctrl and the key in the position of 1 did not choose Applications on a French keyboard ('$(chip_info)')"
echo "ok: on a French keyboard the shortcuts are the digit-row keys, whatever they type"
gsettings reset org.gnome.desktop.input-sources sources
chord Control_L+0
sleep 0.3

# The menu of actions (Ctrl+K) of the selected result.
# menu_state: "hidden", or "<number of actions> <index highlighted> <labels>".
menu_state() {
    shell_eval "(function find(a) { if (a.style_class === 'luciole-menu') { if (!a.visible) return 'hidden'; const rows = a.get_children()[0].get_children().filter(c => c.style_class === 'luciole-menu-row'); return rows.length + ' ' + rows.findIndex(r => r.has_style_pseudo_class('selected')) + ' ' + rows.map(r => r.accessible_name).join(';'); } for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage)"
}
results_visible() {
    shell_eval "(function find(a) { if ((a.style_class || '').includes('luciole-results-view')) return String(a.visible); for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage)"
}
confirmation_shown() {
    shell_eval "(function find(a) { if (a.style_class === 'luciole-menu-confirmation') return 'yes'; for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage) || 'no'"
}
clipboard_text() {
    shell_eval "(function() { globalThis.clipValue = '?'; imports.gi.St.Clipboard.get_default().get_text(imports.gi.St.ClipboardType.CLIPBOARD, (c, t) => { globalThis.clipValue = t; }); return 'asked'; })()" >/dev/null
    sleep 0.4
    shell_eval "String(globalThis.clipValue)"
}
launcher_closed_count() { grep -cF "[Luciole] closed" "$LOG"; }
reopen_launcher() {
    OPENED_NOW=$(grep -cF "[Luciole] opened" "$LOG")
    combo
    wait_log "[Luciole] opened" $((OPENED_NOW + 1)) || fail "the launcher did not reopen"
    sleep 0.4
}

# The calculator: the answer comes first, Enter copies it and says so, the menu offers the whole calculation.
clear_entry 8
typed "2+2*3"
wait_last 'results: 1 first=8 query=2\+2\*3' || fail "no answer for 2+2*3 (last: $(last_results))"
CLOSED_CALC=$(launcher_closed_count)
press Return
sleep 0.1
[ "$(confirmation_shown)" = yes ] || fail "calculator: no confirmation after Enter on the answer"
[ "$(clipboard_text)" = "8" ] || fail "calculator: the clipboard holds '$(clipboard_text)', expected 8"
wait_log "[Luciole] closed" $((CLOSED_CALC + 1)) || fail "calculator: the window did not close after the confirmation"
echo "ok: a calculation is answered first; Enter copies the answer, confirms, then closes"
sleep 0.4
reopen_launcher
typed "5 km en m"
wait_last 'results: 1 first=5000 m query=5 km en m' || fail "no answer for the conversion (last: $(last_results))"
CLOSED_CALC=$(launcher_closed_count)
chord Control_L+k
sleep 0.5
set -- $(menu_state)
[ "$1" = 2 ] || fail "calculator: expected 2 actions (copy the result, copy the calculation), got '$(menu_state)'"
press Down
sleep 0.2
press Return
sleep 0.1
[ "$(confirmation_shown)" = yes ] || fail "calculator: no confirmation after copying the whole calculation"
[ "$(clipboard_text)" = "5 km = 5000 m" ] || fail "calculator: the clipboard holds '$(clipboard_text)', expected the whole calculation"
wait_log "[Luciole] closed" $((CLOSED_CALC + 1)) || fail "calculator: the window did not close"
echo "ok: a conversion is answered, and the menu copies the whole calculation"
sleep 0.4
# While the confirmation is shown the window ignores the keyboard: no second copy, no typing.
reopen_launcher
typed "3*3"
wait_last 'results: 1 first=9 query=3\*3' || fail "no answer for 3*3 (last: $(last_results))"
CLOSED_CALC=$(launcher_closed_count)
COPIES=$(grep -cF "copied the answer" "$LOG")
# Quick, all inside the 0.6 s of the confirmation (which has to be on screen first: the log says so
# faster than a query of the shell could).
SHOWN=$(grep -cF "confirmation shown" "$LOG")
press Return
wait_log "confirmation shown" $((SHOWN + 1)) || fail "calculator: no confirmation for 3*3"
typed z
press Return
chord Control_L+k
sleep 0.15
set -- $(menu_state)
[ "$1" = 0 ] || fail "calculator: Ctrl+K during the confirmation opened the menu ('$(menu_state)')"
[ "$(entry_text_length)" = 3 ] || fail "calculator: typing during the confirmation reached the field ($(entry_text_length) characters, expected 3)"
[ "$(grep -cF "copied the answer" "$LOG")" = $((COPIES + 1)) ] || fail "calculator: Enter during the confirmation copied again ($(grep -cF "copied the answer" "$LOG") copies, expected $((COPIES + 1)))"
wait_log "[Luciole] closed" $((CLOSED_CALC + 1)) || fail "calculator: the window did not close after the confirmation"
echo "ok: during the confirmation the keyboard does nothing"
sleep 0.4
# The menu's first action copies the answer, like Enter, and says so.
reopen_launcher
typed "6*7"
wait_last 'results: 1 first=42 query=6\*7' || fail "no answer for 6*7 (last: $(last_results))"
CLOSED_CALC=$(launcher_closed_count)
chord Control_L+k
sleep 0.5
press Return
sleep 0.1
[ "$(confirmation_shown)" = yes ] || fail "calculator: no confirmation after Copy Result in the menu"
[ "$(clipboard_text)" = "42" ] || fail "calculator: the clipboard holds '$(clipboard_text)', expected 42"
wait_log "[Luciole] closed" $((CLOSED_CALC + 1)) || fail "calculator: the window did not close"
echo "ok: Copy Result in the menu copies the answer and confirms"
sleep 0.4
reopen_launcher
typed "2+2"
wait_last 'results: 1 first=4 query=2\+2' || fail "no answer for 2+2 (last: $(last_results))"
chord Control_L+3
sleep 0.5
wait_last 'results: 1 first=4 query=2\+2' || fail "the Calculator category lost the answer"
[ "$(chip_info)" = "4 3" ] || fail "Ctrl+3 did not check the Calculator chip ('$(chip_info)')"
chord Control_L+1
sleep 0.3
wait_last 'results: 0 first=- query=2\+2' || fail "applications only should not answer a calculation (last: $(last_results))"
chord Control_L+0
clear_entry 3
typed "2026-11-26"
wait_last 'results: 0 first=- query=2026-11-26' || fail "a date was taken for a calculation (last: $(last_results))"
echo "ok: the Calculator category, and a date is left alone"
clear_entry 10
sleep 0.3

clear_entry 8
typed rapport
wait_last 'results: 1 first=rapport' || fail "the real file was not found (last: $(last_results))"
CLOSED_BEFORE=$(launcher_closed_count)
chord Control_L+k
sleep 0.5
set -- $(menu_state)
[ "$1" = 5 ] && [ "$2" = 0 ] || fail "menu: expected 5 actions with the first highlighted, got '$(menu_state)'"
[ "$(results_visible)" = false ] || fail "menu: the results are still shown behind the menu"
echo "ok: Ctrl+K shows the 5 actions of a file in place of the results"
press Down
sleep 0.3
set -- $(menu_state)
[ "$2" = 1 ] || fail "menu: the down arrow did not move the highlight ('$(menu_state)')"
press Up
press Up
sleep 0.3
set -- $(menu_state)
[ "$2" = 4 ] || fail "menu: the up arrow did not wrap to the last action ('$(menu_state)')"
echo "ok: the arrows move the highlight and wrap around"
escape
sleep 0.3
[ "$(menu_state)" = hidden ] || fail "menu: Escape did not close the menu"
[ "$(results_visible)" = true ] || fail "menu: the results did not come back"
[ "$(launcher_closed_count)" = "$CLOSED_BEFORE" ] || fail "menu: Escape closed the whole window"
echo "ok: Escape goes back to the results and keeps the window open"
chord Control_L+k
sleep 0.3
chord Control_L+k
sleep 0.3
[ "$(menu_state)" = hidden ] || fail "menu: Ctrl+K again did not close the menu"
chord Control_L+k
sleep 0.3
typed x
sleep 0.4
[ "$(menu_state)" = hidden ] || fail "menu: typing did not leave the menu"
clear_entry 1
sleep 0.4
echo "ok: Ctrl+K again, or typing, leaves the menu"

# Copy the path: a confirmation, the clipboard holds the path, then the window closes.
wait_last 'results: 1 first=rapport' || fail "results did not come back (last: $(last_results))"
chord Control_L+k
sleep 0.4
press Down
press Down
sleep 0.2
press Return
sleep 0.1
[ "$(confirmation_shown)" = yes ] || fail "menu: no confirmation after Copy Path"
[ "$(clipboard_text)" = "$WORK/docs/rapport-test.txt" ] || fail "menu: the clipboard holds '$(clipboard_text)', expected the path"
wait_log "[Luciole] closed" $((CLOSED_BEFORE + 1)) || fail "menu: the window did not close after the confirmation"
echo "ok: Copy Path puts the path on the clipboard, confirms, then closes"
sleep 0.4
reopen_launcher
typed rapport
wait_last 'results: 1 first=rapport' || fail "results did not come back (last: $(last_results))"
chord Control_L+k
sleep 0.4
press Down
press Down
press Down
sleep 0.2
press Return
sleep 0.3
[ "$(clipboard_text)" = "rapport-test.txt" ] || fail "menu: the clipboard holds '$(clipboard_text)', expected the file name"
wait_log "[Luciole] closed" $((CLOSED_BEFORE + 2)) || fail "menu: the window did not close after Copy Name"
echo "ok: Copy Name puts the name on the clipboard"
sleep 0.4

# Open With: a second level listing the applications, Escape goes back one level at a time.
reopen_launcher
typed rapport
wait_last 'results: 1 first=rapport' || fail "results did not come back (last: $(last_results))"
CLOSED_NOW=$(launcher_closed_count)
chord Control_L+k
sleep 0.4
press Up
sleep 0.2
press Return
sleep 1
set -- $(menu_state)
[ "$1" -ge 1 ] && [ "$1" != 5 ] || fail "menu: Open With did not list applications ('$(menu_state)')"
echo "ok: Open With lists the applications that open the file ($1 here)"
escape
sleep 0.3
set -- $(menu_state)
[ "$1" = 5 ] && [ "$2" = 4 ] || fail "menu: Escape from the submenu did not come back to the actions with Open With highlighted ('$(menu_state)')"
escape
sleep 0.3
[ "$(menu_state)" = hidden ] || fail "menu: a second Escape did not close the menu"
[ "$(launcher_closed_count)" = "$CLOSED_NOW" ] || fail "menu: Escape closed the whole window"
echo "ok: Escape goes back from the submenu, then closes the menu"

# An action that fails (the file of the index is not there) leaves the menu and the window open.
clear_entry 7
typed quok
wait_last 'results: 3 first=.*query=quok' || fail "results did not come back (last: $(last_results))"
chord Control_L+k
sleep 0.4
press Down
sleep 0.2
press Return
wait_log "the file is no longer there" 1 || fail "menu: the failure of Show in Folder was not logged"
sleep 0.5
[ "$(menu_state)" != hidden ] || fail "menu: a failed action closed the menu"
[ "$(launcher_closed_count)" = "$CLOSED_NOW" ] || fail "menu: a failed action closed the window"
echo "ok: a failed action is logged and leaves the menu open"
escape
sleep 0.3

# An application: its own declared action runs (the test one just runs "true").
clear_entry 4
typed factu
wait_last 'results: 2 first=Facture Express query=factu' || fail "the application was not found (last: $(last_results))"
chord Control_L+k
sleep 0.4
set -- $(menu_state)
[ "$1" = 2 ] || fail "menu: expected Open and the application's own action, got '$(menu_state)'"
press Down
sleep 0.2
press Return
wait_log "action app-action:new-test on apps:luciole-test-facture.desktop done" 1 || fail "menu: the application's own action did not run"
wait_log "[Luciole] closed" $((CLOSED_NOW + 1)) || fail "menu: the window did not close after the application's action"
echo "ok: an application's own action runs and the window closes"
sleep 0.4

# A click on an action runs it; closing the window with the menu shown leaves no menu behind.
# menu_row_center <index>: where to click to hit that action.
menu_row_center() {
    shell_eval "(function find(a) { if (a.style_class === 'luciole-menu') { const rows = a.get_children()[0].get_children().filter(c => c.style_class === 'luciole-menu-row'); const c = rows[$1]; const [x, y] = c.get_transformed_position(); const [w, h] = c.get_transformed_size(); return Math.round(x + w / 2) + ' ' + Math.round(y + h / 2); } for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage)"
}
reopen_launcher
typed rapport
wait_last 'results: 1 first=rapport' || fail "results did not come back (last: $(last_results))"
CLOSED_NOW=$(launcher_closed_count)
chord Control_L+k
sleep 0.5
set -- $(menu_row_center 3)
pointer "$1" "$2"
sleep 0.3
click
sleep 0.2
[ "$(clipboard_text)" = "rapport-test.txt" ] || fail "menu: a click on Copy Name did not copy the name (clipboard: '$(clipboard_text)')"
wait_log "[Luciole] closed" $((CLOSED_NOW + 1)) || fail "menu: the window did not close after the click"
echo "ok: a click on an action runs it"
sleep 0.4
reopen_launcher
typed rapport
wait_last 'results: 1 first=rapport' || fail "results did not come back (last: $(last_results))"
chord Control_L+k
sleep 0.5
[ "$(menu_state)" != hidden ] || fail "menu: the menu did not open"
combo
sleep 0.6
reopen_launcher
[ "$(menu_state)" = hidden ] || fail "menu: the menu was still there after closing the window with the shortcut and reopening"
[ "$(results_visible)" = true ] || fail "menu: the results were not shown after reopening"
echo "ok: closing the window with the menu shown leaves no menu behind"
clear_entry 8
escape
wait_log "[Luciole] closed" $((CLOSED_NOW + 3)) || fail "the launcher did not close"
sleep 0.4

# Races: the menu asked for and the window closed, reopened, typed into at once.
reopen_launcher
typed factu
wait_last 'results: 2 first=Facture Express query=factu' || fail "results did not come back (last: $(last_results))"
n=0
while [ "$n" -lt 20 ]; do
    chord Control_L+k
    escape
    escape
    combo
    chord Control_L+k
    typed a
    escape
    escape
    escape
    combo
    n=$((n + 1))
done
sleep 1
kill -0 "$SHELL_PID" 2>/dev/null || fail "menu: the shell died during the race"
[ "$(menu_state)" = hidden ] || [ "$(menu_state)" = "" ] || true
# (The failure provoked on purpose above is logged as an error: it is the only one expected.)
if grep -E 'JS ERROR|CRITICAL' "$LOG" | grep -vF 'the file is no longer there' | grep -q .; then
    grep -E 'JS ERROR|CRITICAL' "$LOG" | grep -vF 'the file is no longer there' | head -5
    fail "menu: errors in the log after the race"
fi
echo "ok: asking for the menu while closing, reopening and typing leaves no error behind"
OPENED_NOW=$(grep -cF "[Luciole] opened" "$LOG")
CLOSED_NOW=$(grep -cF "[Luciole] closed" "$LOG")
if [ $((OPENED_NOW - CLOSED_NOW)) = 0 ]; then
    reopen_launcher
fi
clear_entry 8

# Opening a file is covered by the unit tests, with an injected opener: the files here do not exist.
clear_entry 5
typed quok
wait_log "results: 3 first=" 2 || fail "results did not come back"

grep 'perf query to final results:' "$LOG" | sed -n 's/.*final results: \([0-9.]*\) ms.*/\1/p' >"$LOG.q"
[ -s "$LOG.q" ] || fail "no timing was recorded for the final results"
WORST=$(sort -n "$LOG.q" | tail -n 1)
echo "keystroke to complete results, files included, 50 ms debounce included (this VM): worst ${WORST} ms, budget ${FILES_BUDGET_MS} ms"
awk -v w="$WORST" -v b="$FILES_BUDGET_MS" 'BEGIN { exit !(w + 0 <= b + 0) }' || fail "results took longer than ${FILES_BUDGET_MS} ms"

# (The failure of Show in Folder provoked on purpose in the menu test is the one error expected.)
ERRORS=$(grep -iE "$EXTENSION_ERROR_PATTERN" "$LOG" | grep -vF 'the file is no longer there' | wc -l)
echo "log lines mentioning an error about the extension: $ERRORS"
if [ "$ERRORS" -gt 0 ]; then
    grep -iE "$EXTENSION_ERROR_PATTERN" "$LOG" | grep -vF 'the file is no longer there' | head -10
    fail "errors found in the shell log"
fi
echo "PASS"
