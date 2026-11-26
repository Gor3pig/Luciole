#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later
# File results through the whole stack: a stand-in index published on the test
# bus under LocalSearch's name, the real provider, the real window.
#
#   sh tests/shell/files.sh
#
# Safety: private D-Bus session, private settings, data and cache directories.
# The stand-in index only exists on that session's bus; the real indexer and its
# database are never touched.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
UUID=luciole@gor3pig.github.io

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

glib-compile-schemas "$ROOT/src/schemas"
mkdir -p "$WORK/config/glib-2.0/settings" "$WORK/data/gnome-shell/extensions" "$WORK/data/applications" \
    "$WORK/services/dbus-1/services"
ln -s "$ROOT/src" "$WORK/data/gnome-shell/extensions/$UUID"

cat >"$WORK/data/applications/luciole-test-facture.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Facture Express
Exec=true
DESKTOP
# If our stand-in were late, the bus must not start the real indexer instead.
cat >"$WORK/services/dbus-1/services/org.freedesktop.LocalSearch3.service" <<SERVICE
[D-BUS Service]
Name=org.freedesktop.LocalSearch3
Exec=/usr/bin/false
SERVICE

SHELL_EXTRA_ARGS=--unsafe-mode XDG_DATA_HOME="$WORK/data" XDG_CONFIG_HOME="$WORK/config" XDG_CACHE_HOME="$WORK/cache" \
    XDG_DATA_DIRS="$WORK/services:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}" \
    GSETTINGS_BACKEND=keyfile GSETTINGS_SCHEMA_DIR="$ROOT/src/schemas" G_MESSAGES_DEBUG=all XDG_SESSION_TYPE=wayland \
    dbus-run-session -- sh "$ROOT/tests/shell/files-inner.sh" "$WORK" "$WORK/shell.log" \
    >"$WORK/out.txt" 2>&1 || true

# Set KEEP_OUTPUT=<file> to keep the whole output for debugging.
[ -z "${KEEP_OUTPUT:-}" ] || cp "$WORK/out.txt" "$KEEP_OUTPUT"

grep -E '^(ok:|FAIL|PASS|keystroke to|log lines|----)|\[Luciole\]|JS ERROR|CRITICAL' "$WORK/out.txt" | grep -vE 'DEBUG.*\[Luciole\] (perf|results|apps index|opened|closed|enabled|search ready)' || true
grep -q '^PASS$' "$WORK/out.txt"
