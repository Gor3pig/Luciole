#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later

# The remembered searches: the up and down arrows bring them back in the open launcher, typing
# or Escape leaves them, Clear History and the Remember Searches switch erase them. The history
# file is written before the shell starts (what opening a result records is covered by the unit
# tests: opening one here would start a real application).
#
#   sh tests/shell/history.sh
#
# Safety: private D-Bus session, private settings and data directories.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
UUID=$(sed -n 's/.*"uuid": "\(.*\)".*/\1/p' "$ROOT/src/metadata.json")

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

glib-compile-schemas "$ROOT/src/schemas"
mkdir -p "$WORK/config/glib-2.0/settings" "$WORK/data/gnome-shell/extensions" "$WORK/services/dbus-1/services"
ln -s "$ROOT/src" "$WORK/data/gnome-shell/extensions/$UUID"
cat >"$WORK/services/dbus-1/services/org.freedesktop.LocalSearch3.service" <<SERVICE
[D-BUS Service]
Name=org.freedesktop.LocalSearch3
Exec=/usr/bin/false
SERVICE

run() { # run <mode>: a fresh shell on a fresh D-Bus session, with a prepared history
    mkdir -p "$WORK/data/luciole" "$WORK/config-$1/glib-2.0/settings"
    printf '{"version":1,"queries":["firefox","calculatrice","notes"]}' >"$WORK/data/luciole/queries.json"
    chmod 600 "$WORK/data/luciole/queries.json"
    echo "######## $1"
    SHELL_EXTRA_ARGS="--unsafe-mode" XDG_DATA_HOME="$WORK/data" XDG_CONFIG_HOME="$WORK/config-$1" \
        XDG_CACHE_HOME="$WORK/cache-$1" XDG_DATA_DIRS="$WORK/services:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}" \
        GSETTINGS_BACKEND=keyfile GSETTINGS_SCHEMA_DIR="$ROOT/src/schemas" G_MESSAGES_DEBUG=all XDG_SESSION_TYPE=wayland \
        dbus-run-session -- sh "$ROOT/tests/shell/history-inner.sh" "$WORK" "$WORK/shell-$1.log" "$UUID" "$1" \
        >"$WORK/out-$1.txt" 2>&1 || true
    [ -z "${KEEP_OUTPUT:-}" ] || cp "$WORK/out-$1.txt" "$KEEP_OUTPUT.$1"
    grep -E '^(ok:|FAIL|PASS|history)' "$WORK/out-$1.txt" || true
    grep -q '^PASS$' "$WORK/out-$1.txt" || {
        echo "FAIL: the $1 run did not pass"
        exit 1
    }
}

run arrows
run clear
run off
echo "PASS"
