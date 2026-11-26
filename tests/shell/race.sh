#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later

# Races: the launcher opened and closed faster than its animations, closed while it opens,
# reopened while it closes, disabled while it animates. Whatever the order of events, it must
# end in one consistent state: shown or hidden as its own count says, keyboard never stuck,
# shell alive, no error in the log.
#
#   sh tests/shell/race.sh
#
# Safety: private D-Bus session, private settings and data directories.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
UUID=$(sed -n 's/.*"uuid": "\(.*\)".*/\1/p' "$ROOT/src/metadata.json")

WORK=$(mktemp -d)
# A process of the test shell may still be writing there for a moment after it exits.
trap 'rm -rf "$WORK" 2>/dev/null || { sleep 1; rm -rf "$WORK"; }' EXIT

glib-compile-schemas "$ROOT/src/schemas"
mkdir -p "$WORK/config/glib-2.0/settings" "$WORK/data/gnome-shell/extensions" "$WORK/services/dbus-1/services"
ln -s "$ROOT/src" "$WORK/data/gnome-shell/extensions/$UUID"
cat >"$WORK/services/dbus-1/services/org.freedesktop.LocalSearch3.service" <<SERVICE
[D-BUS Service]
Name=org.freedesktop.LocalSearch3
Exec=/usr/bin/false
SERVICE

SHELL_EXTRA_ARGS="--unsafe-mode" XDG_DATA_HOME="$WORK/data" XDG_CONFIG_HOME="$WORK/config" \
    XDG_CACHE_HOME="$WORK/cache" XDG_DATA_DIRS="$WORK/services:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}" \
    GSETTINGS_BACKEND=keyfile GSETTINGS_SCHEMA_DIR="$ROOT/src/schemas" G_MESSAGES_DEBUG=all XDG_SESSION_TYPE=wayland \
    dbus-run-session -- sh "$ROOT/tests/shell/race-inner.sh" "$WORK" "$WORK/shell.log" "$UUID" \
    >"$WORK/out.txt" 2>&1 || true

[ -z "${KEEP_OUTPUT:-}" ] || { cp "$WORK/out.txt" "$KEEP_OUTPUT"; cp "$WORK/shell.log" "$KEEP_OUTPUT.shell.log"; }
grep -E '^(ok:|FAIL|PASS|race)' "$WORK/out.txt" || true
grep -q '^PASS$' "$WORK/out.txt"
