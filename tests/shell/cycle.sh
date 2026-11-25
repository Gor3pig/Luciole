#!/bin/sh
# Enables and disables the extension N times inside a private, headless
# GNOME Shell, and checks its state, its log and its memory behaviour.
#
#   sh tests/shell/cycle.sh [cycles]      (default: 100)
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
CYCLES=${1:-100}
UUID=luciole@luciole.dev
CONTROL=control@example.invalid
# Allowed growth above the control, in kB, over the second half of the run.
# Measured noise: the same extension grows by 11 to 17 MB (empty control) or 14 to 25 MB
# (Luciole) over 50 cycles from one run to the next, so the limit sits above that noise.
# It catches leaks of roughly 0.5 MB per enable/disable cycle or more; smaller ones
# are not visible in resident memory without forcing garbage collection.
MAX_EXTRA_KB=20480

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

glib-compile-schemas "$ROOT/src/schemas"
. "$ROOT/tests/shell/lib.sh"

run() { # run <name> <uuid> <extensions dir>
    echo "######## $1 ($CYCLES cycles)"
    XDG_DATA_HOME="$3" GSETTINGS_BACKEND=memory XDG_SESSION_TYPE=wayland \
        dbus-run-session -- sh "$ROOT/tests/shell/cycle-inner.sh" "$CYCLES" "$WORK/$1.log" "$2" \
        2>&1 | tee "$WORK/$1.out" | grep -vE '^cycle [0-9]+:|dbus-daemon\[|^$|libedbus|Gdk-Message|connection to the bus|ibus|atspi|portal'
}

make_control_extension "$WORK/control-data" "$CONTROL"

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
    echo "FAIL: memory growth could not be measured (need at least 40 cycles)"
    exit 1
fi
# A control whose memory dropped (a garbage collection) is no baseline to subtract.
[ "$CG" -lt 0 ] && CG=0
EXTRA=$((LG - CG))
echo
echo "memory growth over the second half of the run: control ${CG} kB, Luciole ${LG} kB, extra ${EXTRA} kB (limit ${MAX_EXTRA_KB} kB)"
if [ "$EXTRA" -gt "$MAX_EXTRA_KB" ]; then
    echo "FAIL: Luciole grows more than the empty control"
    exit 1
fi
echo "PASS"
