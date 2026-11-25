#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later
# Opens and closes the launcher N times with the real keyboard shortcut inside a
# private, headless GNOME Shell (keys are injected through Mutter's remote
# desktop interface), then checks timing, memory (what the JavaScript heap keeps alive
# after a collection), the keys and clicks that close the launcher, screen lock and clean-up.
#
#   sh tests/shell/openclose.sh [cycles]      (default: 150)
#
# Safety: the shell runs on its own D-Bus session with its own settings file in
# a temporary directory, so the real session and its settings are never touched.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CYCLES=${1:-150}
UUID=luciole@gor3pig.github.io

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

glib-compile-schemas "$ROOT/src/schemas"
. "$ROOT/tests/shell/lib.sh"

mkdir -p "$WORK/luciole-data/gnome-shell/extensions"
ln -s "$ROOT/src" "$WORK/luciole-data/gnome-shell/extensions/$UUID"

run() { # run <name> <enable 0|1> <uuid> <data dir>
    mkdir -p "$WORK/config-$1/glib-2.0/settings"
    echo "######## $1 ($CYCLES cycles)"
    SHELL_EXTRA_ARGS=--unsafe-mode XDG_DATA_HOME="$4" XDG_CONFIG_HOME="$WORK/config-$1" XDG_CACHE_HOME="$WORK/cache-$1" GSETTINGS_BACKEND=keyfile \
        GSETTINGS_SCHEMA_DIR="$ROOT/src/schemas" G_MESSAGES_DEBUG=all XDG_SESSION_TYPE=wayland \
        dbus-run-session -- sh "$ROOT/tests/shell/openclose-inner.sh" "$1" "$2" "$CYCLES" "$3" "$WORK/$1.log" \
        2>&1 | tee "$WORK/$1.out" | grep -vE '^cycle [0-9]+:|dbus-daemon\[|^$|libedbus|Gdk-Message|connection to the bus|ibus|atspi|portal'
    grep -q '^PASS$' "$WORK/$1.out" || {
        echo "FAIL: the $1 run did not pass"
        exit 1
    }
}

run luciole 1 "$UUID" "$WORK/luciole-data"
echo "PASS"
