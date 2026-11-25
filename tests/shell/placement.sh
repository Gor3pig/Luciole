#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later

# Where the launcher appears, in a private headless GNOME Shell with TWO virtual monitors
# (1280x720 each): on the monitor the pointer is on, the text field a quarter of the way down
# it, and closed when the monitors change. Geometry is read from the live actors.
#
#   sh tests/shell/placement.sh
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

SHELL_EXTRA_ARGS="--unsafe-mode --virtual-monitor 1280x720" XDG_DATA_HOME="$WORK/data" XDG_CONFIG_HOME="$WORK/config" \
    XDG_CACHE_HOME="$WORK/cache" XDG_DATA_DIRS="$WORK/services:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}" \
    GSETTINGS_BACKEND=keyfile GSETTINGS_SCHEMA_DIR="$ROOT/src/schemas" G_MESSAGES_DEBUG=all XDG_SESSION_TYPE=wayland \
    dbus-run-session -- sh "$ROOT/tests/shell/placement-inner.sh" "$WORK" "$WORK/shell.log" "$UUID" \
    >"$WORK/out.txt" 2>&1 || true

[ -z "${KEEP_OUTPUT:-}" ] || { cp "$WORK/out.txt" "$KEEP_OUTPUT"; cp "$WORK/shell.log" "$KEEP_OUTPUT.shell.log"; }
grep -E '^(ok:|FAIL|PASS|monitors|overlay|panel)' "$WORK/out.txt" || true
grep -q '^PASS$' "$WORK/out.txt"
