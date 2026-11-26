#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later
# Runs inside the private D-Bus session started by race.sh. Do not call directly.
set -u

WORK=$1
LOG_FILE=$2
UUID=$3
. "$(dirname "$0")/lib.sh"

start_shell "$LOG_FILE"
wait_for_extension
apps_only
ext_call EnableExtension "$UUID" >/dev/null
wait_ext_state "$STATE_ENABLED" || fail "extension not ENABLED (state=$(ext_state))"
gsettings set org.gnome.shell.extensions.luciole debug-timings true || fail "could not set debug-timings"
start_keys
# input_mode: the shell's action mode (Shell.ActionMode). A modal grab pushed and never popped
# leaves it in POPUP mode.
input_mode() {
    shell_eval "String(globalThis.testMain && globalThis.testMain.actionMode)"
}

shell_eval "import('resource:///org/gnome/shell/ui/main.js').then(m => { globalThis.testMain = m; }); 'ok'" >/dev/null
sleep 0.5
POPUP_MODE=128 # Shell.ActionMode.POPUP, what the launcher's modal grab sets
[ "$(input_mode)" != undefined ] || fail "cannot read the shell action mode"

# The headless shell has animations off (nothing tells it otherwise), which would hide every
# race between an animation and an event. In this private test shell only, the setting is
# overridden on the live settings object, and we check that the extension sees it.
shell_eval "(function() { globalThis.testSettings = imports.gi.St.Settings.get(); Object.defineProperty(globalThis.testSettings, 'enable_animations', {get: () => true, configurable: true}); return 'ok'; })()" >/dev/null
[ "$(shell_eval "String(imports.gi.St.Settings.get().enable_animations)")" = true ] || fail "animations are still off in the test shell"

count() { grep -c "\[Luciole\] $1" "$LOG" || true; }

# overlay_state: "<visible> <opacity>" of the launcher window, or "none" when it does not exist.
overlay_state() {
    shell_eval "(function find(a) { if ((a.style_class || '').includes('luciole-overlay')) return String(a.visible) + ' ' + a.opacity; for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage) || 'none'"
}

# grab_state: who holds the keyboard and pointer grab: "none" or the style class of its actor.
grab_state() {
    shell_eval "(function() { const g = global.stage.get_grab_actor(); return (!g || g === global.stage) ? 'none' : (g.style_class || g.constructor.name); })()"
}

# The height of the results list, sampled inside the shell every 8 ms (a call from here is too slow
# to see a 120 ms animation). start_sampler, then do things, then read_samples.
start_sampler() {
    shell_eval "(function find(a) { if ((a.style_class || '').includes('luciole-results-view')) return a; for (const c of a.get_children()) { const r = find(c); if (r) return r; } return null; })(global.stage) && (function() { const find = a => (a.style_class || '').includes('luciole-results-view') ? a : a.get_children().map(find).find(Boolean); const view = find(global.stage); globalThis.heightSamples = []; globalThis.sampling = true; imports.gi.GLib.timeout_add(imports.gi.GLib.PRIORITY_DEFAULT, 8, () => { globalThis.heightSamples.push(Math.round(view.height)); return globalThis.sampling; }); return 'started'; })()" >/dev/null
}
read_samples() {
    shell_eval "globalThis.sampling = false; globalThis.heightSamples.join(' ')"
}
# list_state: "<height> <natural height> <has a fixed height>" of the results list.
list_state() {
    shell_eval "(function find(a) { if ((a.style_class || '').includes('luciole-results-view')) return Math.round(a.height) + ' ' + Math.round(a.get_preferred_height(-1)[1]) + ' ' + a.natural_height_set; for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage)"
}

# settle: lets every animation end.
settle() { sleep 1.2; }

# consistent <label>: after the dust settles, what the log says (opened minus closed) must be
# what is on screen, and the shell must be alive and quiet.
consistent() {
    settle
    DIFF=$(($(count opened) - $(count closed)))
    STATE=$(overlay_state)
    kill -0 "$SHELL_PID" 2>/dev/null || fail "$1: the shell died"
    case "$DIFF" in
        0) [ "$STATE" = "false 0" ] || [ "$STATE" = "false 255" ] || [ "$STATE" = none ] ||
            fail "$1: closed according to the log, but the window is '$STATE'" ;;
        1) [ "$STATE" = "true 255" ] || fail "$1: open according to the log, but the window is '$STATE'" ;;
        *) fail "$1: opened minus closed is $DIFF" ;;
    esac
    GRAB=$(grab_state)
    case "$DIFF" in
        0) [ "$GRAB" = none ] || fail "$1: closed, but '$GRAB' still holds the grab"
           [ "$(input_mode)" != "$POPUP_MODE" ] || fail "$1: closed, but the shell is still in the modal popup mode (a grab was not released)" ;;
        1) [ "$GRAB" = luciole-overlay ] || fail "$1: open, but the grab is held by '$GRAB'"
           [ "$(input_mode)" = "$POPUP_MODE" ] || fail "$1: open, but the shell action mode is $(input_mode), not the modal popup mode" ;;
    esac
    [ -z "$(log_errors 'JS ERROR|CRITICAL|\[Luciole\] .*error')" ] || fail "$1: errors in the log: $(log_errors 'JS ERROR|CRITICAL|\[Luciole\] .*error' | head -n 3)"
    echo "race: $1 -> $([ "$DIFF" = 1 ] && echo open || echo closed), consistent"
}

# keyboard_ok: the launcher is open and typing reaches it (the keyboard is not stuck), then Escape closes it.
keyboard_ok() {
    [ "$(( $(count opened) - $(count closed) ))" = 1 ] || fail "$1: expected an open launcher"
    typed ab
    sleep 0.3
    [ "$(entry_text_length)" = 2 ] || fail "$1: typing does not reach the launcher (keyboard stuck)"
    escape
    sleep 0.1
    escape
    settle
    [ "$(( $(count opened) - $(count closed) ))" = 0 ] || fail "$1: Escape did not close the launcher"
}

# 1. Rapid toggles: 200 presses with no pause. Each one toggles, so the end state is exact.
n=0
while [ "$n" -lt 200 ]; do combo; n=$((n + 1)); done
consistent "200 rapid toggles"
[ "$(count opened)" = 100 ] && [ "$(count closed)" = 100 ] || fail "200 toggles gave $(count opened) openings and $(count closed) closings, expected 100 each"

# 2. An odd number: ends open, and the keyboard works.
n=0
while [ "$n" -lt 101 ]; do combo; n=$((n + 1)); done
consistent "101 rapid toggles"
keyboard_ok "after 101 toggles"

# 3. Closed at once while it opens (Escape right after the shortcut), repeated.
n=0
while [ "$n" -lt 40 ]; do combo; escape; escape; n=$((n + 1)); done
consistent "closed while opening, 40 times"

# 4. Reopened while it closes: shortcut, Escape, shortcut with no pause.
n=0
while [ "$n" -lt 40 ]; do
    combo; escape; combo
    sleep 0.5
    escape; escape
    sleep 0.2
    n=$((n + 1))
done
consistent "reopened while closing, 40 times"
combo
sleep 0.6
consistent "reopened while closing, final"
keyboard_ok "after reopening while closing"

# 6. The list changes height: it eases when animations are on, and jumps when the setting is off.
# The test's own applications (see race.sh): "zquok" 4 rows, "zquok b" 2, "zquok be" 1. The heights
# themselves depend on the fonts of the machine, so they are measured first.
open_and_type() {
    OPENED=$(count opened)
    combo
    i=0; while [ "$(count opened)" -le "$OPENED" ] && [ "$i" -lt 100 ]; do sleep 0.05; i=$((i + 1)); done
    sleep 0.4
    typed zquok
    sleep 0.6
}
open_and_type
H1=$(list_state | cut -d' ' -f1)
typed " b"
sleep 0.6
H2=$(list_state | cut -d' ' -f1)
typed e
sleep 0.6
H3=$(list_state | cut -d' ' -f1)
escape; escape; settle
[ "$H1" -gt "$H2" ] && [ "$H2" -gt "$H3" ] || fail "height: the test applications should give three heights, got $H1 $H2 $H3"

open_and_type
set -- $(list_state)
[ "$1" = "$H1" ] || fail "height: expected $H1 px for 'zquok', got '$1'"
start_sampler
typed " be"
sleep 0.6
SAMPLES=$(read_samples)
set -- $(list_state)
[ "$1" = "$H3" ] && [ "$2" = "$H3" ] && [ "$3" = false ] || fail "height: after easing the list is '$*', expected $H3 $H3 false (exactly natural, no fixed height)"
BETWEEN=0
for h in $SAMPLES; do
    [ "$h" -ge "$H3" ] && [ "$h" -le "$H1" ] || fail "height: a sample ($h) is outside $H3-$H1 (overshoot) in: $SAMPLES"
    [ "$h" != "$H1" ] && [ "$h" != "$H2" ] && [ "$h" != "$H3" ] && BETWEEN=$((BETWEEN + 1))
done
[ "$BETWEEN" -ge 2 ] || fail "height: the list did not ease (only $BETWEEN in-between heights) in: $SAMPLES"
echo "race: height eased from $H1 to $H3 px through $BETWEEN in-between heights, ends exactly natural"
escape; escape; settle

gsettings set org.gnome.shell.extensions.luciole animations false || fail "could not turn the animations setting off"
open_and_type
start_sampler
typed " be"
sleep 0.6
SAMPLES=$(read_samples)
for h in $SAMPLES; do
    [ "$h" = "$H1" ] || [ "$h" = "$H2" ] || [ "$h" = "$H3" ] || fail "height: with the setting off, the list passed through $h px in: $SAMPLES"
done
set -- $(list_state)
[ "$1" = "$H3" ] && [ "$3" = false ] || fail "height: with the setting off the list is '$*'"
echo "race: with the setting off, the height jumps (no in-between height)"
escape; escape; settle
gsettings set org.gnome.shell.extensions.luciole animations true || fail "could not turn the animations setting on"
consistent "after the height tests"

# 5. The extension disabled while the window animates, then enabled again.
OPENED=$(count opened)
combo
i=0; while [ "$(count opened)" -le "$OPENED" ] && [ "$i" -lt 100 ]; do sleep 0.01; i=$((i + 1)); done
[ "$(count opened)" -gt "$OPENED" ] || fail "disabled while opening: the launcher did not open first"
ext_call DisableExtension "$UUID" >/dev/null
wait_ext_state "$STATE_DISABLED" || fail "disabled while opening: the extension is not DISABLED (state=$(ext_state))"
settle
kill -0 "$SHELL_PID" 2>/dev/null || fail "disabled while opening: the shell died"
[ "$(luciole_actors)" = 0 ] || fail "disabled while opening: actors left in the scene"
[ "$(input_mode)" != "$POPUP_MODE" ] || fail "disabled while opening: the shell is still in the modal popup mode"
[ "$(grab_state)" = none ] || fail "disabled while opening: the grab is still held by '$(grab_state)'"
[ -z "$(log_errors 'JS ERROR|CRITICAL')" ] || fail "disabled while opening: errors in the log: $(log_errors 'JS ERROR|CRITICAL' | head -n 3)"
echo "race: disabled while opening -> clean, nothing left"
ext_call EnableExtension "$UUID" >/dev/null
wait_ext_state "$STATE_ENABLED" || fail "enabled again: not ENABLED (state=$(ext_state))"
OPENED=$(count opened)
combo
i=0; while [ "$(count opened)" -le "$OPENED" ] && [ "$i" -lt 100 ]; do sleep 0.05; i=$((i + 1)); done
[ "$(count opened)" -gt "$OPENED" ] || fail "enabled again: the launcher does not open"
escape
sleep 0.5
echo "race: works again after being re-enabled"
echo "PASS"
