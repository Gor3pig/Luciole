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

# The test shell starts in the overview and this test leaves it there: Luciole is used over the
# overview, which is also what a preview must cope with (the keyboard must go to its window).
start_shell "$LOG_FILE"
start_index_service
wait_for_extension
gsettings set org.gnome.shell.extensions.luciole debug-timings true || fail "could not set debug-timings"
# GNOME offers Log Out only with several accounts or sessions, or when this asks it to: the test
# must not depend on the accounts of the machine it runs on.
gsettings set org.gnome.shell always-show-log-out true || fail "could not show Log Out"
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

# ---- Helpers ----

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
# The menu of actions is GNOME's own (a popup menu over the window).
# menu_state: "hidden", or "<number of actions> <index highlighted> <labels>"; while "Open With…" is
# unfolded, those of its applications.
menu_state() {
    shell_eval "(function() { let bp = null; (function f(a) { if (bp) return; if ((a.style_class || '').includes('luciole-context-menu')) { bp = a; return; } a.get_children().forEach(f); })(global.stage); const m = bp && bp._delegate; if (!m || !m.isOpen) return 'hidden'; const sub = m._getMenuItems().find(i => i.menu && i.menu.isOpen); const rows = (sub ? sub.menu : m)._getMenuItems().filter(i => i.reactive && i.label); const f = global.stage.key_focus; return rows.length + ' ' + rows.findIndex(i => f && (i === f || i.contains(f))) + ' ' + rows.map(i => i.label.text).join(';'); })()"
}
# context_menus: how many of the launcher's menus exist (shown or not): none once one is closed.
context_menus() {
    shell_eval "(function() { let n = 0; (function f(a) { if ((a.style_class || '').includes('luciole-context-menu')) n++; a.get_children().forEach(f); })(global.stage); return String(n); })()"
}
# focus_in_field: whether the keyboard is in the search field.
focus_in_field() {
    shell_eval "(function() { const f = global.stage.key_focus; let p = f; while (p) { if ((p.style_class || '').includes('luciole-entry')) return 'yes'; p = p.get_parent(); } return 'no'; })()"
}
results_visible() {
    shell_eval "(function find(a) { if ((a.style_class || '').includes('luciole-results-view')) return String(a.visible); for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage)"
}
confirmation_shown() {
    shell_eval "(function find(a) { if (a.style_class === 'luciole-menu-confirmation' && a.mapped) return 'yes'; for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage) || 'no'"
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
# selected_row: the title of the highlighted result, or "none".
selected_row() {
    shell_eval "(function find(a) { if ((a.style_class || '').includes('luciole-row') && a.has_style_pseudo_class && a.has_style_pseudo_class('selected')) return (function t(b) { if ((b.style_class || '').includes('luciole-row-title')) return b.get_children().map(c => c.text || '').join(''); for (const c of b.get_children()) { const r = t(c); if (r) return r; } return ''; })(a) || 'untitled'; for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage) || 'none'"
}
type_label() {
    shell_eval "(function find(a) { if ((a.style_class || '').includes('luciole-type-chip')) return a.visible ? a.text : 'hidden'; for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage)"
}
# menu_row_center <index>: where to click to hit that action.
# result_row_center <index>: where to click to hit that row of results; result_row_title <index>: its title.
result_row_center() {
    shell_eval "(function() { const rows = []; (function walk(a) { if (a.style_class === 'luciole-row' && a.visible) rows.push(a); a.get_children().forEach(walk); })(global.stage); const c = rows[$1]; if (!c) return ''; const [x, y] = c.get_transformed_position(); const [w, h] = c.get_transformed_size(); return Math.round(x + w / 2) + ' ' + Math.round(y + h / 2); })()"
}
menu_title() {
    shell_eval "(function() { let bp = null; (function f(a) { if (bp) return; if ((a.style_class || '').includes('luciole-context-menu')) { bp = a; return; } a.get_children().forEach(f); })(global.stage); const m = bp && bp._delegate; if (!m || !m.isOpen) return 'none'; const t = m._getMenuItems().find(i => !i.reactive && i.label); return t ? t.label.text : 'none'; })()"
}
# escape_preview <count of "back" before>: Escape to the preview until it is closed. Just after it
# opens, the previewer may not handle keys yet and ignores an Escape: then another is sent (four at most).
escape_preview() {
    tries=0
    while [ "$tries" -lt 4 ]; do
        escape
        wait_log "back from the preview" $(($1 + 1)) 1 && return 0
        tries=$((tries + 1))
    done
    return 1
}
menu_row_center() {
    shell_eval "(function() { let bp = null; (function f(a) { if (bp) return; if ((a.style_class || '').includes('luciole-context-menu')) { bp = a; return; } a.get_children().forEach(f); })(global.stage); const m = bp && bp._delegate; if (!m || !m.isOpen) return ''; const sub = m._getMenuItems().find(i => i.menu && i.menu.isOpen); const rows = (sub ? sub.menu : m)._getMenuItems().filter(i => i.reactive && i.label); const c = rows[$1]; if (!c) return ''; const [x, y] = c.get_transformed_position(); const [w, h] = c.get_transformed_size(); return Math.round(x + w / 2) + ' ' + Math.round(y + h / 2); })()"
}
# wait_menu: until the menu is shown (the actions are listed first), two seconds at most.
wait_menu() {
    i=0; while [ "$i" -lt 20 ] && [ "$(menu_state)" = hidden ]; do sleep 0.1; i=$((i + 1)); done
    [ "$(menu_state)" != hidden ]
}

# ---- Parts: each can run alone (FILES_PARTS="menu calc"; empty: all of them) ----
part() {
    [ -z "${FILES_PARTS:-}" ] && return 0
    case " $FILES_PARTS " in *" $1 "*) return 0 ;; esac
    return 1
}
# fresh_start: the window open, the field empty (no type label), no menu, All chosen, the usual
# keyboard layout: whatever the part before it left.
# The window is asked about, not guessed from the log: after the races a close may still be under way.
launcher_shown() {
    shell_eval "(function find(a) { if ((a.style_class || '').includes('luciole-overlay')) return a.visible && a.opacity === 255 ? 'yes' : 'no'; for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage) || 'no'"
}
fresh_start() {
    gsettings reset org.gnome.desktop.input-sources sources 2>/dev/null || true
    sleep 0.5
    if [ "$(launcher_shown)" != yes ]; then
        reopen_launcher
    fi
    [ "$(launcher_shown)" = yes ] || fail "the launcher is not shown at the start of a part ($(launcher_shown))"
    [ "$(menu_state)" = hidden ] || escape
    clear_entry 30
    chord Control_L+0
    sleep 0.4
}

wait_log "search ready: apps, files" || fail "both providers did not start"
combo
wait_log "[Luciole] opened" || fail "the launcher did not open"

if part basics; then
fresh_start
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
# The icon of a row and its text are apart (measured on screen: the space is the box's, not the button's).
GAP=$(shell_eval "(function find(a) { if ((a.style_class || '').includes('luciole-row-content') && a.visible) { const [icon, text] = a.get_children(); return String(Math.round(text.x - (icon.x + icon.width))); } for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage) || 'none'")
[ "$GAP" = 12 ] || fail "a row's icon and text should be 12 px apart, they are $GAP"
echo "ok: a row's icon and text are 12 px apart"
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
fi

if part categories; then
fresh_start
# Categories: chips under the field, Ctrl+0/1/2 and a click choose where the search goes.
typed factu
wait_last 'results: 2 first=Facture Express query=factu' || fail "categories: the application and the file were not found (last: $(last_results))"

[ "$(chip_info)" = "5 0" ] || fail "categories: expected 3 chips with the first checked, got '$(chip_info)'"
echo "ok: the chips are there (All, Applications, Files, Calculator, System), All is chosen"
chord Control_L+2
wait_last 'results: 1 first=Facture m.* query=factu' || fail "Ctrl+2 did not restrict to files (last: $(last_results))"
[ "$(chip_info)" = "5 2" ] || fail "Ctrl+2 did not check the Files chip ('$(chip_info)')"
chord Control_L+1
wait_last 'results: 1 first=Facture Express query=factu' || fail "Ctrl+1 did not restrict to applications (last: $(last_results))"
[ "$(chip_info)" = "5 1" ] || fail "Ctrl+1 did not check the Applications chip ('$(chip_info)')"
chord Control_L+0
wait_last 'results: 2 first=Facture Express query=factu' || fail "Ctrl+0 did not bring everything back (last: $(last_results))"
[ "$(chip_info)" = "5 0" ] || fail "Ctrl+0 did not check the All chip ('$(chip_info)')"
echo "ok: Ctrl+2 files only, Ctrl+1 applications only, Ctrl+0 everything"
chord Control_L+5
sleep 0.4
[ "$(chip_info)" = "5 0" ] || fail "Ctrl+5 changed the category although there is no fifth source ('$(chip_info)')"
[ "$(wc -l <"$WORK/closed-count" 2>/dev/null || echo 0)" = 0 ] || true
echo "ok: a digit with no source behind it does nothing"

CLOSED_BEFORE=$(grep -cF "[Luciole] closed" "$LOG")
set -- $(chip_center 2)
pointer "$1" "$2"
sleep 0.3
click
wait_last 'results: 1 first=Facture m.* query=factu' || fail "a click on the Files chip did not restrict to files (last: $(last_results))"
[ "$(chip_info)" = "5 2" ] || fail "the click did not check the Files chip ('$(chip_info)')"
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
[ "$(chip_info)" = "5 0" ] || fail "reopening did not start on All ('$(chip_info)')"
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
[ "$(chip_info)" = "5 2" ] || fail "Ctrl and the key in the position of 2 did not choose Files on a French keyboard ('$(chip_info)')"
send "code Control_L+2"
sleep 0.5
[ "$(chip_info)" = "5 1" ] || fail "Ctrl and the key in the position of 1 did not choose Applications on a French keyboard ('$(chip_info)')"
echo "ok: on a French keyboard the shortcuts are the digit-row keys, whatever they type"
gsettings reset org.gnome.desktop.input-sources sources
chord Control_L+0
sleep 0.3

# The menu of actions (Ctrl+K) of the selected result.
fi

if part system; then
fresh_start
# The System source: Settings panels and the shell's own actions. What ends the session is never
# chosen for the user.
clear_entry 8
typed "panneau luciole"
wait_last 'results: 1 first=Panneau Luciole de test query=panneau luciole' || fail "the test panel was not found (last: $(last_results))"
sleep 0.3
[ "$(selected_row)" != none ] || fail "system: an ordinary panel should be selected for the user"
CLOSED_SYS=$(launcher_closed_count)
rm -f "$WORK/panel-ran"
press Return
wait_log "[Luciole] closed" $((CLOSED_SYS + 1)) || fail "system: the window did not close after Enter on a panel"
i=0; while [ ! -e "$WORK/panel-ran" ] && [ "$i" -lt 60 ]; do sleep 0.1; i=$((i + 1)); done
[ -e "$WORK/panel-ran" ] || fail "system: opening the panel did not run its launcher"
echo "ok: a Settings panel is found by its name, and Enter opens it after the window closes"
# The same through the menu (Ctrl+K, then Open): the window is gone before the panel is opened.
sleep 0.4
reopen_launcher
typed "panneau luciole"
wait_last 'results: 1 first=Panneau Luciole de test query=panneau luciole' || fail "the test panel was not found again (last: $(last_results))"
CLOSED_SYS=$(launcher_closed_count)
ACTIVATED=$(grep -cF '[Luciole] activating ' "$LOG")
rm -f "$WORK/panel-ran"
chord Control_L+k
wait_menu || fail "system: Ctrl+K did not open the menu"
press Return
wait_log "[Luciole] closed" $((CLOSED_SYS + 1)) || fail "system: the window did not close after Open in the menu"
i=0; while [ ! -e "$WORK/panel-ran" ] && [ "$i" -lt 60 ]; do sleep 0.1; i=$((i + 1)); done
[ -e "$WORK/panel-ran" ] || fail "system: Open in the menu did not open the panel"
[ "$(grep -cF '[Luciole] activating ' "$LOG")" = $((ACTIVATED + 1)) ] &&
    grep -F '[Luciole] activating ' "$LOG" | tail -n 1 | grep -qF '(window closed first)' ||
    fail "system: Open in the menu did not run the panel the usual way, once the window was closed"
echo "ok: Open in the menu of a panel also closes the window first"
sleep 0.4
reopen_launcher
typed "wifi"
wait_last 'results: 1 first=Wi-Fi query=wifi' || fail "the Wi-Fi panel was not found (last: $(last_results))"
chord Control_L+4
sleep 0.5
[ "$(chip_info)" = "5 4" ] || fail "Ctrl+4 did not check the System chip ('$(chip_info)')"
wait_last 'results: 1 first=Wi-Fi query=wifi' || fail "the System category lost the panel (last: $(last_results))"
chord Control_L+0
clear_entry 4
echo "ok: the System category"

# Logging out is offered but never selected for the user; Enter does nothing until an arrow chooses it.
typed "deconnecter"
wait_last 'results: 1 first=Fermer la session query=deconnecter' || fail "the log out action was not found (last: $(last_results))"
sleep 0.4
[ "$(selected_row)" = none ] || fail "system: log out was selected for the user ('$(selected_row)')"
CLOSED_SYS=$(launcher_closed_count)
press Return
sleep 0.6
[ "$(launcher_closed_count)" = "$CLOSED_SYS" ] || fail "system: Enter acted on a result that was not chosen"
press Down
sleep 0.3
[ "$(selected_row)" = "Fermer la session" ] || fail "system: the down arrow did not choose log out ('$(selected_row)')"
echo "ok: an action that ends the session is never chosen for the user; Enter does nothing until an arrow does"

# Locking is not drastic: it is chosen like any result (and not run here: it would lock the test shell).
clear_entry 11
typed "verrouiller"
wait_last 'results: 2 first=Verrouiller' || fail "the lock action was not found (last: $(last_results))"
sleep 0.4
[ "$(selected_row)" != none ] || fail "system: the lock action should be selected like an ordinary result"
echo "ok: locking the screen is chosen like an ordinary result"
clear_entry 12
sleep 0.3
fi

if part preview; then
fresh_start
# The preview: Space on a file chosen with the arrows steps aside for GNOME's previewer (the real
# one, on this private bus), and the window comes back as it was when the preview is closed.
clear_entry 8
typed rapport
wait_last 'results: 1 first=rapport' || fail "the real file was not found (last: $(last_results))"
typed " "
sleep 0.3
[ "$(entry_text_length)" = 8 ] || fail "preview: Space before any arrow should type a space ($(entry_text_length) characters, expected 8)"
press BackSpace
wait_last 'results: 1 first=rapport.* query=rapport$' || fail "results did not come back (last: $(last_results))"
press Down
sleep 0.3
HINTS=$(shell_eval "(function count(a) { return ((a.style_class || '').includes('luciole-row-hint') && a.visible ? 1 : 0) + a.get_children().reduce((n, c) => n + count(c), 0); })(global.stage)")
[ "$HINTS" = 1 ] || fail "preview: the chosen file does not say that Space previews it ($HINTS hints shown)"
HIDDEN=$(grep -cF "hidden for the preview" "$LOG")
BACK=$(grep -cF "back from the preview" "$LOG")
typed " "
wait_log "hidden for the preview" $((HIDDEN + 1)) || fail "preview: Space on a chosen file did not step aside"
echo "preview: $(grep -F 'previewer' "$LOG" | tail -n 1 | sed 's/.*\[Luciole\] //')"
i=0
while [ "$i" -lt 50 ]; do
    shell_eval "global.get_window_actors().map(a => a.meta_window.get_wm_class()).join(',')" | grep -qi previewer && break
    sleep 0.2
    i=$((i + 1))
done
echo "preview: windows now: $(shell_eval "global.get_window_actors().map(a => a.meta_window.get_wm_class()).join(',')")"
# The window gets the keyboard soon after it shows (later on a busy machine): up to 5 s.
i=0
while [ "$i" -lt 25 ]; do
    FOCUSED=$(shell_eval "String(global.display.focus_window?.get_wm_class() ?? 'none')")
    [ "$FOCUSED" = org.gnome.NautilusPreviewer ] && break
    sleep 0.2
    i=$((i + 1))
done
echo "preview: keyboard focus on $FOCUSED"
[ "$FOCUSED" = org.gnome.NautilusPreviewer ] || fail "preview: the preview window did not get the keyboard"
sleep 0.5
escape_preview "$BACK" || fail "preview: the window did not come back after the preview (grab: $(shell_eval "(function() { const g = global.stage.get_grab_actor(); return (!g || g === global.stage) ? 'none' : (g.style_class || g.constructor.name); })()"); key focus: $(shell_eval "String(global.stage.key_focus?.constructor?.name ?? 'none') + ' ' + String(global.stage.key_focus?.style_class ?? '')"); windows: $(shell_eval "global.get_window_actors().map(a => a.meta_window.get_wm_class()).join(',')"); focus: $(shell_eval "String(global.display.focus_window?.get_wm_class() ?? 'none')"); log: $(grep -F '[Luciole] preview' "$LOG" | tail -n 3 | sed 's/.*\[Luciole\] //' | tr '\n' ';'))"
grep -F "back from the preview" "$LOG" | tail -n 1 | sed 's/.*\[Luciole\] /preview: /'
sleep 0.4
[ "$(entry_text_length)" = 7 ] || fail "preview: the search was not kept ($(entry_text_length) characters, expected 7)"
echo "ok: Space on a file chosen with the arrows shows the preview; the window comes back with the same search"

# Ctrl+Y works without the arrows; the shortcut of Luciole during a preview opens it fresh, and the
# end of that preview does not bring the old search back.
HIDDEN=$(grep -cF "hidden for the preview" "$LOG")
BACK=$(grep -cF "back from the preview" "$LOG")
OPENED_NOW=$(grep -cF "[Luciole] opened" "$LOG")
chord Control_L+y
wait_log "hidden for the preview" $((HIDDEN + 1)) || fail "preview: Ctrl+Y did not show the preview"
sleep 1
combo
wait_log "[Luciole] opened" $((OPENED_NOW + 1)) || fail "preview: the shortcut did not open the launcher during the preview"
sleep 0.4
[ "$(entry_text_length)" = 0 ] || fail "preview: the launcher opened during a preview should start empty"
escape
sleep 0.5
shell_eval "global.get_window_actors().filter(a => a.meta_window.get_wm_class() === 'org.gnome.NautilusPreviewer').forEach(a => a.meta_window.delete(global.get_current_time())); 'closed'" >/dev/null
sleep 1.5
[ "$(grep -cF "back from the preview" "$LOG")" = "$BACK" ] || fail "preview: the old search came back after the launcher had been opened again"
echo "ok: Ctrl+Y previews; opening Luciole during a preview starts fresh and nothing comes back afterwards"
# A preview already on screen when another is asked for: it shows the new file without saying it
# became visible. The window must stay out of the way until that preview is closed.
reopen_launcher
typed rapport
wait_last 'results: 1 first=rapport' || fail "results did not come back (last: $(last_results))"
HIDDEN=$(grep -cF "hidden for the preview" "$LOG")
BACK=$(grep -cF "back from the preview" "$LOG")
chord Control_L+y
wait_log "hidden for the preview" $((HIDDEN + 1)) || fail "preview: Ctrl+Y did not show the first preview"
sleep 1.5
combo
sleep 0.6
typed rapport
wait_last 'results: 1 first=rapport' || fail "results did not come back during the preview (last: $(last_results))"
chord Control_L+y
wait_log "hidden for the preview" $((HIDDEN + 2)) || fail "preview: Ctrl+Y did not step aside for the preview already shown"
sleep 6
[ "$(grep -cF "back from the preview" "$LOG")" = "$BACK" ] || fail "preview: the window came back while the preview was still on screen"
shell_eval "global.get_window_actors().filter(a => a.meta_window.get_wm_class() === 'org.gnome.NautilusPreviewer').forEach(a => a.meta_window.delete(global.get_current_time())); 'closed'" >/dev/null
wait_log "back from the preview" $((BACK + 1)) || fail "preview: the window did not come back once the preview already shown was closed"
echo "ok: with a preview already on screen, the window waits for it to be closed"
clear_entry 8
CLOSED_PV=$(launcher_closed_count)
escape
wait_log "[Luciole] closed" $((CLOSED_PV + 1)) || fail "preview: Escape did not close the window afterwards"
sleep 0.4
reopen_launcher
typed rapport
wait_last 'results: 1 first=rapport' || fail "results did not come back (last: $(last_results))"
HIDDEN=$(grep -cF "hidden for the preview" "$LOG")
BACK=$(grep -cF "back from the preview" "$LOG")
chord Control_L+k
wait_menu || fail "preview: Ctrl+K did not open the menu"
press Down
press Down
sleep 0.2
press Return
wait_log "hidden for the preview" $((HIDDEN + 1)) || fail "preview: the menu's Preview did not show the preview"
sleep 1
escape_preview "$BACK" || fail "preview: the window did not come back after a preview from the menu"
sleep 0.4
[ "$(menu_state)" = hidden ] || fail "preview: the menu was still shown after coming back"
[ "$(entry_text_length)" = 7 ] || fail "preview: the search was not kept after a preview from the menu"
echo "ok: Preview in the menu works the same way"
clear_entry 8
sleep 0.3
fi

if part types; then
fresh_start
# The type filter: "/" lists the types; one chosen becomes a label in the field and restricts the
# search to files of that type; Backspace at the start takes it away; "/etc/hosts" is just text.
clear_entry 12
typed "/"
wait_last 'results: 8 first=Images query=/' || fail "type filter: '/' did not list the eight types (last: $(last_results))"
press Down
press Down
sleep 0.3
press Return
sleep 0.6
[ "$(type_label)" = PDF ] || fail "type filter: choosing PDF did not put the label in the field ('$(type_label)')"
[ "$(entry_text_length)" = 0 ] || fail "type filter: the field should hold only the words ($(entry_text_length) characters)"
[ "$(chip_info)" = "5 2" ] || fail "type filter: the Files category was not chosen with the type ('$(chip_info)')"
typed quok
wait_last 'results: 0 first=- query=/pdf quok' || fail "type filter: /pdf quok should find nothing: the quokka files are images and documents (last: $(last_results))"
clear_entry 4
typed facture
wait_last 'results: 1 first=Facture mars.pdf query=/pdf facture' || fail "type filter: /pdf facture did not find only the PDF (last: $(last_results))"
echo "ok: '/' lists the types; PDF chosen becomes a label and only PDF files are found"
clear_entry 7
sleep 0.3
press BackSpace
sleep 0.5
[ "$(type_label)" = hidden ] || fail "type filter: Backspace at the start did not take the type away ('$(type_label)')"
[ "$(chip_info)" = "5 0" ] || fail "type filter: the category did not come back to All ('$(chip_info)')"
typed "/images quok"
wait_last 'results: 1 first=quokka-photo.png query=/images quok' || fail "type filter: typing /images quok did not find only the image (last: $(last_results))"
[ "$(type_label)" = Images ] || fail "type filter: typing '/images ' did not make the label ('$(type_label)')"
echo "ok: typing '/images ' makes the label; Backspace at the start takes it away"
clear_entry 6
press BackSpace
sleep 0.4
typed "/etc/hosts"
sleep 0.8
[ "$(type_label)" = hidden ] || fail "type filter: '/etc/hosts' was taken for a type"
last_results | grep -q 'query=/etc/hosts' || fail "type filter: '/etc/hosts' was not searched as text (last: $(last_results))"
clear_entry 12
typed "/pd"
wait_last 'results: 1 first=PDF query=/pd' || fail "type filter: '/pd' did not suggest PDF (last: $(last_results))"
press Tab
sleep 0.6
[ "$(type_label)" = PDF ] || fail "type filter: Tab did not complete the type ('$(type_label)')"
press BackSpace
sleep 0.4
echo "ok: an unknown '/word' is plain text; Tab completes a type"
typed "/pdf "
sleep 0.6
[ "$(type_label)" = PDF ] || fail "type filter: the label did not come for the reopening check"
CLOSED_T=$(launcher_closed_count)
combo
wait_log "[Luciole] closed" $((CLOSED_T + 1)) || fail "type filter: the launcher did not close"
sleep 0.4
reopen_launcher
[ "$(type_label)" = hidden ] || fail "type filter: reopening kept the type ('$(type_label)')"
echo "ok: reopening starts without a type"
# Choosing another source while a type is shown takes the type away: what the chips say is what is searched.
typed "/pdf facture"
wait_last 'results: 1 first=Facture mars.pdf query=/pdf facture' || fail "type filter: /pdf facture not found again (last: $(last_results))"
chord Control_L+1
sleep 0.6
[ "$(type_label)" = hidden ] || fail "type filter: choosing Applications kept the PDF label"
[ "$(chip_info)" = "5 1" ] || fail "type filter: the Applications chip is not the chosen one ('$(chip_info)')"
wait_last 'results: 1 first=Facture Express query=facture$' || fail "type filter: Applications should search 'facture' among applications (last: $(last_results))"
chord Control_L+0
sleep 0.4
echo "ok: choosing another source takes the type of file away"
clear_entry 8
sleep 0.3
fi

if part calc; then
fresh_start
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
# Ctrl+Enter on an answer (it has no other action) does nothing, and the window stays.
typed "3*3"
wait_last 'results: 1 first=9 query=3\*3' || fail "no answer for 3*3 (last: $(last_results))"
CLOSED_CALC=$(launcher_closed_count)
chord Control_L+Return
sleep 0.6
[ "$(launcher_closed_count)" = "$CLOSED_CALC" ] || fail "calculator: Ctrl+Enter on an answer closed the window"
echo "ok: Ctrl+Enter on an answer leaves the window open"
clear_entry 4
typed "5 km en m"
wait_last 'results: 1 first=5000 m query=5 km en m' || fail "no answer for the conversion (last: $(last_results))"
CLOSED_CALC=$(launcher_closed_count)
chord Control_L+k
wait_menu || fail "calculator: Ctrl+K did not open the menu"
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
SEARCHES=$(grep -cF '[Luciole] results:' "$LOG")
typed z
press Return
chord Control_L+k
chord Control_L+1
sleep 0.15
[ "$(menu_state)" = hidden ] || fail "calculator: Ctrl+K during the confirmation opened the menu ('$(menu_state)')"
# A category chosen would search again, and say so in the log.
[ "$(grep -cF '[Luciole] results:' "$LOG")" = "$SEARCHES" ] || fail "calculator: Ctrl+1 during the confirmation searched again ($(last_results))"
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
wait_menu || fail "calculator: Ctrl+K did not open the menu"
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
[ "$(chip_info)" = "5 3" ] || fail "Ctrl+3 did not check the Calculator chip ('$(chip_info)')"
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
fi

if part menu; then
fresh_start
clear_entry 8
typed rapport
wait_last 'results: 1 first=rapport' || fail "the real file was not found (last: $(last_results))"
CLOSED_BEFORE=$(launcher_closed_count)
chord Control_L+k
wait_menu || fail "menu: Ctrl+K did not open the menu"
set -- $(menu_state)
[ "$1" = 6 ] && [ "$2" = 0 ] || fail "menu: expected 6 actions with the first highlighted, got '$(menu_state)'"
[ "$(results_visible)" = true ] || fail "menu: the results are hidden behind the menu"
[ "$(menu_title)" = "rapport-test.txt" ] || fail "menu: the menu is titled '$(menu_title)', expected the file"
echo "ok: Ctrl+K opens GNOME's menu with the 6 actions of a file, over the results"
press Down
sleep 0.3
set -- $(menu_state)
[ "$2" = 1 ] || fail "menu: the down arrow did not move the highlight ('$(menu_state)')"
press Up
press Up
sleep 0.3
set -- $(menu_state)
[ "$2" = 5 ] || fail "menu: the up arrow did not wrap to the last action ('$(menu_state)')"
echo "ok: the arrows move the highlight and wrap around"
escape
sleep 0.4
[ "$(menu_state)" = hidden ] || fail "menu: Escape did not close the menu"
[ "$(launcher_closed_count)" = "$CLOSED_BEFORE" ] || fail "menu: Escape closed the whole window"
[ "$(focus_in_field)" = yes ] || fail "menu: the keyboard did not come back to the field"
[ "$(context_menus)" = 0 ] || fail "menu: the menu closed is still there ($(context_menus))"
LENGTH=$(entry_text_length)
typed x
sleep 0.4
[ "$(entry_text_length)" = $((LENGTH + 1)) ] || fail "menu: typing after the menu did not reach the field ($(entry_text_length) characters, expected $((LENGTH + 1)))"
clear_entry 1
echo "ok: Escape closes the menu only; the keyboard is back in the field"

# Copy the path: a confirmation, the clipboard holds the path, then the window closes.
wait_last 'results: 1 first=rapport' || fail "results did not come back (last: $(last_results))"
chord Control_L+k
wait_menu || fail "menu: Ctrl+K did not open the menu"
press Down
press Down
press Down
sleep 0.2
press Return
i=0; while [ "$i" -lt 20 ] && [ "$(confirmation_shown)" != yes ]; do sleep 0.05; i=$((i + 1)); done
[ "$(confirmation_shown)" = yes ] || fail "menu: no confirmation after Copy Path"
[ "$(clipboard_text)" = "$WORK/docs/rapport-test.txt" ] || fail "menu: the clipboard holds '$(clipboard_text)', expected the path"
wait_log "[Luciole] closed" $((CLOSED_BEFORE + 1)) || fail "menu: the window did not close after the confirmation"
echo "ok: Copy Path puts the path on the clipboard, confirms, then closes"
sleep 0.4
reopen_launcher
typed rapport
wait_last 'results: 1 first=rapport' || fail "results did not come back (last: $(last_results))"
chord Control_L+k
wait_menu || fail "menu: Ctrl+K did not open the menu"
press Down
press Down
press Down
press Down
sleep 0.2
press Return
sleep 0.4
[ "$(clipboard_text)" = "rapport-test.txt" ] || fail "menu: the clipboard holds '$(clipboard_text)', expected the file name"
wait_log "[Luciole] closed" $((CLOSED_BEFORE + 2)) || fail "menu: the window did not close after Copy Name"
echo "ok: Copy Name puts the name on the clipboard"
sleep 0.4

# Open With: unfolds in the menu, listing the applications; the left arrow folds it again.
reopen_launcher
typed rapport
wait_last 'results: 1 first=rapport' || fail "results did not come back (last: $(last_results))"
CLOSED_NOW=$(launcher_closed_count)
chord Control_L+k
wait_menu || fail "menu: Ctrl+K did not open the menu"
press Up
sleep 0.2
press Right
sleep 0.6
set -- $(menu_state)
[ "$1" -ge 1 ] && [ "$1" != 6 ] || fail "menu: Open With did not list applications ('$(menu_state)')"
case "$(menu_state)" in *"Lecteur Luciole de test"*) ;; *) fail "menu: Open With does not offer the test reader ('$(menu_state)')" ;; esac
echo "ok: Open With unfolds the applications that open the file ($1 here: $(menu_state))"
press Left
sleep 0.4
set -- $(menu_state)
[ "$1" = 6 ] && [ "$2" = 5 ] || fail "menu: the left arrow did not fold Open With back ('$(menu_state)')"
press Right
sleep 0.6
OPENED_WITH=$(grep -cF "menu action: " "$LOG")
press Return
wait_log "menu action: " $((OPENED_WITH + 1)) || fail "menu: choosing an application in Open With did nothing"
grep -F "menu action: " "$LOG" | tail -n 1 | grep -qF "menu action: open-with:luciole-test-reader.desktop" ||
    fail "menu: Open With ran '$(grep -F "menu action: " "$LOG" | tail -n 1)', expected the test reader"
echo "ok: the application chosen in Open With opens the file"
wait_log "[Luciole] closed" $((CLOSED_NOW + 1)) || fail "menu: the window did not close after Open With"
sleep 0.4
reopen_launcher
clear_entry 8

# Under the pointer a row takes a light tint, unlike the chosen one; the chosen one under the pointer
# keeps its own. row_tint <index>: "<red>,<green>,<blue>,<alpha>" of that row's background.
row_tint() {
    shell_eval "(function() { const rows = []; (function walk(a) { if (a.style_class === 'luciole-row' && a.visible) rows.push(a); a.get_children().forEach(walk); })(global.stage); const r = rows[$1]; if (!r) return ''; const c = r.get_theme_node().get_background_color(); return [c.red, c.green, c.blue, c.alpha].join(','); })()"
}
clear_entry 12
typed quok
wait_last 'results: 3 first=.*query=quok' || fail "results did not come back (last: $(last_results))"
CHOSEN=$(row_tint 0)
set -- $(result_row_center 2)
pointer "$1" "$2"
i=0; while [ "$i" -lt 30 ]; do HOVERED=$(row_tint 2); case "$HOVERED" in *,0|"") ;; *) break ;; esac; sleep 0.1; i=$((i + 1)); done
[ -n "$HOVERED" ] && [ "$HOVERED" != "$CHOSEN" ] || fail "hover: the row under the pointer looks chosen ($HOVERED, chosen $CHOSEN)"
case "$HOVERED" in *,0) fail "hover: the row under the pointer shows nothing ($HOVERED)" ;; esac
set -- $(result_row_center 0)
pointer "$1" "$2"
i=0; while [ "$i" -lt 30 ] && [ "$(row_tint 2)" = "$HOVERED" ]; do sleep 0.1; i=$((i + 1)); done
[ "$(row_tint 0)" = "$CHOSEN" ] || fail "hover: the chosen row under the pointer lost its tint ($(row_tint 0), was $CHOSEN)"
echo "ok: the row under the pointer has a light tint of its own; the chosen one keeps its tint"

# A right click on a row shows the actions of that result (not of the one selected before).
clear_entry 12
typed quok
wait_last 'results: 3 first=.*query=quok' || fail "results did not come back (last: $(last_results))"
CLOSED_RC=$(launcher_closed_count)
# (The list may still be redrawn for a moment after the results are logged.)
i=0; while [ "$i" -lt 20 ]; do set -- $(result_row_center 1); [ "$#" = 2 ] && break; sleep 0.1; i=$((i + 1)); done
[ "$#" = 2 ] || fail "right click: the second row was not found"
SECOND=$(shell_eval "(function() { const rows = []; (function walk(a) { if (a.style_class === 'luciole-row' && a.visible) rows.push(a); a.get_children().forEach(walk); })(global.stage); return rows[1] ? rows[1].get_accessible_name?.() ?? '' : ''; })()")
[ -n "$SECOND" ] || fail "right click: the second row has no name"
pointer "$1" "$2"
# A click that lands while the list is redrawn (the files arrive after the applications) is lost:
# up to three tries, the row's place read again each time.
tries=0
while [ "$tries" -lt 3 ]; do
    send rclick
    wait_menu && break
    tries=$((tries + 1))
    set -- $(result_row_center 1)
    [ "$#" = 2 ] && pointer "$1" "$2"
done
[ "$(menu_state)" != hidden ] || fail "right click: no menu of actions"
TITLE=$(menu_title)
[ "$TITLE" != none ] && [ -n "$TITLE" ] || fail "right click: the menu has no title"
case "$SECOND" in *"$TITLE"*) ;; *) fail "right click: the menu is for '$TITLE', not for the row clicked ('$SECOND')" ;; esac
grep -F '[Luciole] selected: ' "$LOG" | tail -n 1 | grep -qF "$(printf '%s' "$TITLE" | cut -c1-6)" || fail "right click: the row clicked was not chosen"
escape
sleep 0.3
[ "$(menu_state)" = hidden ] || fail "right click: Escape did not close the menu"
[ "$(launcher_closed_count)" = "$CLOSED_RC" ] || fail "right click: the window closed"
[ "$(focus_in_field)" = yes ] || fail "right click: the keyboard did not come back to the field"
# A click beside the menu closes the menu only.
set -- $(result_row_center 1)
pointer "$1" "$2"
send rclick
wait_menu || fail "right click: the menu did not open again"
set -- $(result_row_center 0)
pointer "$1" "$(( $2 - 4 ))"
click
sleep 0.5
[ "$(menu_state)" = hidden ] || fail "right click: a click beside the menu did not close it"
[ "$(launcher_closed_count)" = "$CLOSED_RC" ] || fail "right click: a click beside the menu closed the window"
[ "$(focus_in_field)" = yes ] || fail "right click: the keyboard did not come back to the field after a click beside the menu"
pointer 60 650
send rclick
wait_log "[Luciole] closed" $((CLOSED_RC + 1)) || fail "right click outside the window did not close it"
echo "ok: a right click shows the actions of the row clicked; Escape or a click beside closes the menu only; outside the window it closes it"
sleep 0.4
reopen_launcher
CLOSED_NOW=$(launcher_closed_count)

# Show in Folder (Ctrl+Enter) asks the file manager to show the file itself, selected in its folder.
clear_entry 12
typed rapport
wait_last 'results: 1 first=rapport' || fail "the real file was not found (last: $(last_results))"
CLOSED_SF=$(launcher_closed_count)
chord Control_L+Return
wait_log "[Luciole] closed" $((CLOSED_SF + 1)) || fail "show in folder: the window did not close"
i=0; while ! grep -q "ShowItems" "$FILEMANAGER_RECORD" 2>/dev/null && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
grep -qx "ShowItems file://$INDEX_REAL_FILE" "$FILEMANAGER_RECORD" ||
    fail "show in folder: the file manager was not asked to show the file ($(cat "$FILEMANAGER_RECORD" 2>/dev/null))"
echo "ok: Show in Folder asks the file manager to show the file itself, selected"
sleep 0.4
reopen_launcher
CLOSED_NOW=$(launcher_closed_count)

# An action that fails (the file of the index is not there) leaves the window open, the keyboard in the field.
clear_entry 7
typed quok
wait_last 'results: 3 first=.*query=quok' || fail "results did not come back (last: $(last_results))"
chord Control_L+k
wait_menu || fail "menu: Ctrl+K did not open the menu"
press Down
sleep 0.2
press Return
wait_log "the file is no longer there" 1 || fail "menu: the failure of Show in Folder was not logged"
sleep 0.5
[ "$(launcher_closed_count)" = "$CLOSED_NOW" ] || fail "menu: a failed action closed the window"
[ "$(focus_in_field)" = yes ] || fail "menu: the keyboard is not in the field after a failed action"
echo "ok: a failed action is logged and leaves the window open"

# An application: its own declared action runs (the test one just runs "true").
clear_entry 4
typed factu
wait_last 'results: 2 first=Facture Express query=factu' || fail "the application was not found (last: $(last_results))"
chord Control_L+k
wait_menu || fail "menu: Ctrl+K did not open the menu"
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
reopen_launcher
typed rapport
wait_last 'results: 1 first=rapport' || fail "results did not come back (last: $(last_results))"
CLOSED_NOW=$(launcher_closed_count)
chord Control_L+k
wait_menu || fail "menu: Ctrl+K did not open the menu"
set -- $(menu_row_center 4)
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
wait_menu || fail "menu: the menu did not open"
combo
sleep 0.6
[ "$(context_menus)" = 0 ] || fail "menu: the menu is still there after the window was closed ($(context_menus))"
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
[ "$(context_menus)" -le 1 ] || fail "menu: menus were left behind by the race ($(context_menus))"
# (The failure provoked on purpose above is logged as an error: it is the only one expected.)
if log_errors 'JS ERROR|CRITICAL' | grep -vF 'the file is no longer there' | grep -q .; then
    log_errors 'JS ERROR|CRITICAL' | grep -vF 'the file is no longer there' | head -5
    fail "menu: errors in the log after the race"
fi
echo "ok: asking for the menu while closing, reopening and typing leaves no error behind"
OPENED_NOW=$(grep -cF "[Luciole] opened" "$LOG")
CLOSED_NOW=$(grep -cF "[Luciole] closed" "$LOG")
if [ $((OPENED_NOW - CLOSED_NOW)) = 0 ]; then
    reopen_launcher
fi
clear_entry 8
fi

# Opening a file is covered by the unit tests, with an injected opener: the files here do not exist.
fresh_start
typed quok
wait_last 'results: 3 first=.*query=quok' || fail "results did not come back (last: $(last_results))"

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
