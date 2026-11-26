#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later
# Enables and disables the extension N times inside a private, headless
# GNOME Shell, and checks its state, its log and its memory behaviour.
#
#   sh tests/shell/cycle.sh [cycles]      (default: 100)
#
# GNOME Shell itself keeps a little more alive at every enable/disable cycle, even
# with an empty extension. The memory check is therefore differential: the same
# cycles are run with an empty control extension, and only the growth above the
# control counts. Memory is the JavaScript heap after a forced collection, not the
# resident size (a sawtooth, because the collector runs late).
#
# Safety: each shell runs on its own D-Bus session with an in-memory settings
# backend, so the real session and its settings are never touched.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CYCLES=${1:-100}
UUID=luciole@gor3pig.github.io
CONTROL=control@example.invalid
# Allowed growth above the control, in bytes, of what the JavaScript heap keeps alive after a
# garbage collection, from the end of the warm-up (a quarter of the cycles) to the end.
MAX_EXTRA_BYTES=200000
# (measured: 20 to 45 kB over 75 cycles; this catches a leak of a few kB per cycle)

WORK=$(mktemp -d)
# A process of the test shell may still be writing there for a moment after it exits.
trap 'rm -rf "$WORK" 2>/dev/null || { sleep 1; rm -rf "$WORK"; }' EXIT

glib-compile-schemas "$ROOT/src/schemas"
. "$ROOT/tests/shell/lib.sh"

run() { # run <name> <uuid> <extensions dir>
    echo "######## $1 ($CYCLES cycles)"
    SHELL_EXTRA_ARGS=--unsafe-mode XDG_DATA_HOME="$3" XDG_CONFIG_HOME="$WORK/config-$1" GSETTINGS_BACKEND=keyfile XDG_SESSION_TYPE=wayland \
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

growth() { sed -n 's/^heap_growth=//p' "$WORK/$1.out" | tail -n 1; }
CG=$(growth control)
LG=$(growth luciole)
if [ -z "$CG" ] || [ -z "$LG" ]; then
    echo "FAIL: heap growth could not be measured (need at least 8 cycles)"
    exit 1
fi
# A control whose heap shrank is no baseline to subtract.
[ "$CG" -lt 0 ] && CG=0
EXTRA=$((LG - CG))
echo
echo "heap growth after warm-up: control ${CG} bytes, Luciole ${LG} bytes, extra ${EXTRA} bytes (limit ${MAX_EXTRA_BYTES} bytes)"
if [ "$EXTRA" -gt "$MAX_EXTRA_BYTES" ]; then
    echo "FAIL: Luciole keeps more alive than the empty control"
    exit 1
fi
echo "PASS"
