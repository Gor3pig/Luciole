#!/bin/sh
# Enables and disables the extension N times inside a private, headless
# GNOME Shell, and checks its state, its log and its memory behaviour.
#
#   sh tests/shell/cycle.sh [cycles]      (default: 60)
#
# GNOME Shell itself grows by a few hundred kB per enable/disable cycle, even
# with an empty extension. The memory check is therefore differential: the same
# cycles are run with an empty control extension, and only the growth above the
# control counts.
#
# Safety: each shell runs on its own D-Bus session with an in-memory settings
# backend, so the real session and its settings are never touched.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CYCLES=${1:-60}
UUID=luciole@luciole.dev
CONTROL=control@example.invalid
# Allowed growth above the control, in kB, between cycle 10 and the last cycle.
MAX_EXTRA_KB=5120

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

glib-compile-schemas "$ROOT/src/schemas"

run() { # run <name> <uuid> <extensions dir>
    echo "######## $1 ($CYCLES cycles)"
    XDG_DATA_HOME="$3" GSETTINGS_BACKEND=memory XDG_SESSION_TYPE=wayland \
        dbus-run-session -- sh "$ROOT/tests/shell/cycle-inner.sh" "$CYCLES" "$WORK/$1.log" "$2" \
        2>&1 | tee "$WORK/$1.out" | grep -vE '^cycle [0-9]+:|dbus-daemon\[|^$|libedbus|Gdk-Message|connection to the bus|ibus|atspi|portal'
}

# Control: an extension that does nothing.
CDIR="$WORK/control-data/gnome-shell/extensions/$CONTROL"
mkdir -p "$CDIR"
printf '{"uuid":"%s","name":"Control","description":"empty","shell-version":["50","51"]}\n' "$CONTROL" >"$CDIR/metadata.json"
printf 'import {Extension} from "resource:///org/gnome/shell/extensions/extension.js";\nexport default class Control extends Extension { enable() {} disable() {} }\n' >"$CDIR/extension.js"

# Luciole, linked from the working tree.
mkdir -p "$WORK/luciole-data/gnome-shell/extensions"
ln -s "$ROOT/src" "$WORK/luciole-data/gnome-shell/extensions/$UUID"

# The pipeline in run() hides the exit status of the inner script, so each run
# must have printed its own PASS line.
passed() {
    grep -q '^PASS$' "$WORK/$1.out" || {
        echo "FAIL: the $1 run did not pass"
        exit 1
    }
}

run control "$CONTROL" "$WORK/control-data"
passed control
run luciole "$UUID" "$WORK/luciole-data"
passed luciole

growth() { sed -n 's/^growth_kb=//p' "$WORK/$1.out" | tail -n 1; }
CG=$(growth control)
LG=$(growth luciole)
if [ -z "$CG" ] || [ -z "$LG" ]; then
    echo "FAIL: memory growth could not be measured (need at least 10 cycles)"
    exit 1
fi
EXTRA=$((LG - CG))
echo
echo "memory growth from cycle 10: control ${CG} kB, Luciole ${LG} kB, extra ${EXTRA} kB (limit ${MAX_EXTRA_KB} kB)"
if [ "$EXTRA" -gt "$MAX_EXTRA_KB" ]; then
    echo "FAIL: Luciole grows more than the empty control"
    exit 1
fi
echo "PASS"
