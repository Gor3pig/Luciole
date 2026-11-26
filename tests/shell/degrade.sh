#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later
# The file provider is enabled but the file index service is missing (simulated
# with a D-Bus service that fails to start): applications must keep working and
# the problem must be reported exactly once.
#
#   sh tests/shell/degrade.sh
#
# Safety: private D-Bus session, private settings, data and cache directories.
# The failing service file only exists in that session's search path, so the
# real file indexer is never started.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
UUID=luciole@gor3pig.github.io

WORK=$(mktemp -d)
# A process of the test shell may still be writing there for a moment after it exits.
trap 'rm -rf "$WORK" 2>/dev/null || { sleep 1; rm -rf "$WORK"; }' EXIT

glib-compile-schemas "$ROOT/src/schemas"
mkdir -p "$WORK/config/glib-2.0/settings" "$WORK/data/gnome-shell/extensions" "$WORK/data/applications" \
    "$WORK/services/dbus-1/services"
ln -s "$ROOT/src" "$WORK/data/gnome-shell/extensions/$UUID"

cat >"$WORK/data/applications/luciole-test-fiche.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Fiche Zèbre
Exec=true
DESKTOP
cat >"$WORK/services/dbus-1/services/org.freedesktop.LocalSearch3.service" <<SERVICE
[D-BUS Service]
Name=org.freedesktop.LocalSearch3
Exec=/usr/bin/false
SERVICE

XDG_DATA_HOME="$WORK/data" XDG_CONFIG_HOME="$WORK/config" XDG_CACHE_HOME="$WORK/cache" \
    XDG_DATA_DIRS="$WORK/services:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}" \
    GSETTINGS_BACKEND=keyfile GSETTINGS_SCHEMA_DIR="$ROOT/src/schemas" G_MESSAGES_DEBUG=all XDG_SESSION_TYPE=wayland \
    dbus-run-session -- sh "$ROOT/tests/shell/degrade-inner.sh" "$WORK" "$WORK/shell.log" \
    >"$WORK/out.txt" 2>&1 || true

# Set KEEP_OUTPUT=<file> to keep the whole output for debugging.
[ -z "${KEEP_OUTPUT:-}" ] || cp "$WORK/out.txt" "$KEEP_OUTPUT"

grep -E '^(ok:|FAIL|PASS|log lines|----)|\[Luciole\]|JS ERROR|CRITICAL' "$WORK/out.txt" | grep -vE 'DEBUG.*\[Luciole\] (perf|results|apps index|opened|closed|enabled|search ready)' || true
grep -q '^PASS$' "$WORK/out.txt"
