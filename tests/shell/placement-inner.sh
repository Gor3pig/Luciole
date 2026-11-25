#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later
# Runs inside the private D-Bus session started by placement.sh. Do not call directly.
set -u

WORK=$1
LOG_FILE=$2
UUID=$3
. "$(dirname "$0")/lib.sh"

start_shell "$LOG_FILE"
wait_for_extension
gsettings set org.gnome.shell.extensions.luciole debug-timings true || fail "could not set debug-timings"
apps_only
ext_call EnableExtension "$UUID" >/dev/null
wait_ext_state "$STATE_ENABLED" || fail "extension not ENABLED (state=$(ext_state))"
start_keys

count() { grep -c "\[Luciole\] $1" "$LOG" || true; }
wait_count() {
    i=0
    while [ "$i" -lt 100 ]; do
        [ "$(count "$1")" -ge "$2" ] && return 0
        sleep 0.05
        i=$((i + 1))
    done
    return 1
}

N=$(shell_eval "String(global.display.get_n_monitors())")
echo "monitors: $N"
[ "$N" = 2 ] || fail "expected two virtual monitors, found '$N'"
SECOND_X=$(shell_eval "String(global.display.get_monitor_geometry(1).x)")
SECOND_Y=$(shell_eval "String(global.display.get_monitor_geometry(1).y)")
echo "monitors: the second one starts at $SECOND_X,$SECOND_Y"

# open_at <x> <y>: puts the pointer there, opens the launcher and waits for it.
open_at() {
    OPENED=$(count opened)
    pointer "$1" "$2"
    sleep 0.3
    combo
    wait_count 'opened' $((OPENED + 1)) || fail "the launcher did not open with the pointer at $1,$2"
    sleep 0.4
}
close_launcher() {
    CLOSED=$(count closed)
    escape
    wait_count 'closed' $((CLOSED + 1)) || fail "the launcher did not close"
    sleep 0.3
}

# The pointer on the first monitor: the window covers it and starts at its origin.
open_at 640 360
set -- $(actor_geometry luciole-overlay)
echo "overlay: first monitor -> x=$1 y=$2 ${3}x${4}"
[ "$1" = 0 ] && [ "$2" = 0 ] && [ "$3" = 1280 ] && [ "$4" = 720 ] || fail "the window is not on the first monitor"
set -- $(actor_geometry luciole-panel)
echo "panel: y=$2 height=$4"
# The field a quarter down: 720 * 0.25 = 180.
[ "$2" -ge 178 ] && [ "$2" -le 182 ] || fail "the panel is not a quarter of the way down (y=$2, expected about 180)"
close_launcher

# The pointer on the second monitor: the window moves there.
open_at $((SECOND_X + 640)) 360
set -- $(actor_geometry luciole-overlay)
echo "overlay: second monitor -> x=$1 y=$2 ${3}x${4}"
[ "$1" = "$SECOND_X" ] && [ "$2" = "$SECOND_Y" ] && [ "$3" = 1280 ] || fail "the window did not follow the pointer to the second monitor"
set -- $(actor_geometry luciole-panel)
[ "$1" -gt "$SECOND_X" ] || fail "the panel is not on the second monitor (x=$1)"
echo "ok: the launcher appears on the monitor the pointer is on"

# A monitor change while it is open closes it (the shell's own signal, sent from outside).
# Two independent mechanisms guarantee it: the extension's own handler, and the loss of keyboard
# focus that the shell's re-layout causes; the test cannot tell them apart, only that it closes.
CLOSED=$(count closed)
SENT=$(shell_eval "global.backend.get_monitor_manager().emit('monitors-changed'); 'sent'")
[ "$SENT" = sent ] || fail "could not send the monitors-changed signal (got '$SENT')"
wait_count 'closed' $((CLOSED + 1)) || fail "the launcher stayed open when the monitors changed"
echo "ok: the launcher closes when the monitors change"

# And it opens normally afterwards.
open_at 640 360
close_launcher
echo "ok: it opens and closes again afterwards"
echo "PASS"
