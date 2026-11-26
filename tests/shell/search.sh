#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later
# Searches in a private, headless GNOME Shell with test applications made for
# the occasion, and checks results, activation, history, recent items and the
# reaction to an application being installed while the launcher runs.
#
#   sh tests/shell/search.sh
#
# Safety: the shell runs on its own D-Bus session with its own settings file and
# its own data directory in a temporary location; nothing of the real session
# or of the user's data is read or written.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
UUID=luciole@gor3pig.github.io

WORK=$(mktemp -d)
# A process of the test shell may still be writing there for a moment after it exits.
trap 'rm -rf "$WORK" 2>/dev/null || { sleep 1; rm -rf "$WORK"; }' EXIT

glib-compile-schemas "$ROOT/src/schemas"
mkdir -p "$WORK/config/glib-2.0/settings" "$WORK/data/gnome-shell/extensions" "$WORK/data/applications"
ln -s "$ROOT/src" "$WORK/data/gnome-shell/extensions/$UUID"

desktop() { # desktop <file> <name> <keywords> <command>
    cat >"$WORK/data/applications/$1" <<DESKTOP
[Desktop Entry]
Type=Application
Name=$2
GenericName=Test application
Keywords=$3
Exec=$4
DESKTOP
}
desktop luciole-test-marker.desktop "Luciole Test Marker" "zzmarker;" "touch $WORK/launched"
desktop luciole-test-phantom.desktop "Éditeur Fantôme" "" "true"
desktop luciole-test-zebra.desktop "Application Zèbre Rapide" "" "true"

XDG_DATA_HOME="$WORK/data" XDG_CONFIG_HOME="$WORK/config" XDG_CACHE_HOME="$WORK/cache" GSETTINGS_BACKEND=keyfile \
    GSETTINGS_SCHEMA_DIR="$ROOT/src/schemas" G_MESSAGES_DEBUG=all XDG_SESSION_TYPE=wayland \
    dbus-run-session -- sh "$ROOT/tests/shell/search-inner.sh" "$WORK" "$WORK/shell.log" \
    >"$WORK/out.txt" 2>&1 || true

# Set KEEP_OUTPUT=<file> to keep the whole output for debugging.
[ -z "${KEEP_OUTPUT:-}" ] || cp "$WORK/out.txt" "$KEEP_OUTPUT"

# Show the verdicts and the extension's own lines, not the noise of the other processes.
grep -E '^(ok:|FAIL|PASS|keystroke to results|log lines|----)|\[Luciole\]|JS ERROR|CRITICAL' "$WORK/out.txt" | grep -vE 'DEBUG.*\[Luciole\] (perf|results|apps index|opened|closed|enabled|search ready)' || true
grep -q '^PASS$' "$WORK/out.txt"
