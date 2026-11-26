#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later

# Endurance test: thousands of random actions (open, type, erase, arrows, Tab,
# Escape, Return) in a private, headless GNOME Shell, then
# checks that the shell is alive, the log is clean, every opening was closed,
# the keyboard is not stuck and memory did not keep growing.
#
#   sh tests/shell/soak.sh [actions] [seed]      (defaults: 6000, 1)
#
# Safety: private D-Bus session, private settings, data and cache directories.
# Only made-up test applications can be launched; random words never match a
# real application.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ACTIONS=${1:-6000}
SEED=${2:-1}
UUID=$(sed -n 's/.*"uuid": "\(.*\)".*/\1/p' "$ROOT/src/metadata.json")

WORK=$(mktemp -d)
# A process of the test shell may still be writing there for a moment after it exits.
trap 'rm -rf "$WORK" 2>/dev/null || { sleep 1; rm -rf "$WORK"; }' EXIT

glib-compile-schemas "$ROOT/src/schemas"
mkdir -p "$WORK/config/glib-2.0/settings" "$WORK/data/gnome-shell/extensions" "$WORK/data/applications" \
    "$WORK/services/dbus-1/services"
ln -s "$ROOT/src" "$WORK/data/gnome-shell/extensions/$UUID"

cat >"$WORK/data/applications/luciole-test-marker.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Luciole Test Marker
Keywords=zzmark;
Exec=true
DESKTOP
cat >"$WORK/services/dbus-1/services/org.freedesktop.LocalSearch3.service" <<SERVICE
[D-BUS Service]
Name=org.freedesktop.LocalSearch3
Exec=/usr/bin/false
SERVICE

# The random actions, reproducible from the seed. Words start with "zzq" so they
# match no real application, so validating (Return) finds nothing to launch: launching
# applications in a screenless shell changes its state in ways unrelated to Luciole,
# and tests/shell/search.sh covers the activation itself.
awk -v n="$ACTIONS" -v seed="$SEED" 'BEGIN {
    srand(seed)
    split("zzqa zzqb zzqkx zzqlong zzqq zzqwxyz", words, " ")
    for (i = 0; i < n; i++) {
        r = int(rand() * 100)
        if (r < 14) print "combo"
        else if (r < 40) print "type " words[1 + int(rand() * 6)]
        else if (r < 52) print "key BackSpace"
        else if (r < 62) print "key Down"
        else if (r < 70) print "key Up"
        else if (r < 77) print "key Tab"
        else if (r < 82) print "key ISO_Left_Tab"
        else if (r < 92) print "escape"
        else print "key Return"
    }
}' >"$WORK/actions.txt"

# SOAK_ACTIONS_FILE=<file> replaces the random actions with a fixed script (for bisecting).
[ -z "${SOAK_ACTIONS_FILE:-}" ] || cp "$SOAK_ACTIONS_FILE" "$WORK/actions.txt"

SHELL_EXTRA_ARGS=--unsafe-mode XDG_DATA_HOME="$WORK/data" XDG_CONFIG_HOME="$WORK/config" XDG_CACHE_HOME="$WORK/cache" \
    XDG_DATA_DIRS="$WORK/services:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}" \
    GSETTINGS_BACKEND=keyfile GSETTINGS_SCHEMA_DIR="$ROOT/src/schemas" G_MESSAGES_DEBUG=all XDG_SESSION_TYPE=wayland \
    dbus-run-session -- sh "$ROOT/tests/shell/soak-inner.sh" "$WORK" "$WORK/shell.log" "$UUID" \
    >"$WORK/out.txt" 2>&1 || true

# Set KEEP_OUTPUT=<file> to keep the output and the shell log (<file>.shell.log) for debugging.
[ -z "${KEEP_OUTPUT:-}" ] || { cp "$WORK/out.txt" "$KEEP_OUTPUT"; cp "$WORK/shell.log" "$KEEP_OUTPUT.shell.log"; cp "$WORK/actions.txt" "$KEEP_OUTPUT.actions"; }
grep -E '^(ok:|FAIL|PASS|actions|memory|opened|----)|\[Luciole\]|JS ERROR|CRITICAL' "$WORK/out.txt" | grep -vE 'DEBUG.*\[Luciole\] (perf|results|apps index|opened|closed|enabled|search ready|selected|installed|disabling)' || true
grep -q '^PASS$' "$WORK/out.txt"
