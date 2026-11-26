#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later
# Takes a PNG screenshot of the open launcher inside a private, headless GNOME
# Shell: no real desktop is captured.
#
#   sh tests/shell/capture.sh <output.png> [light|dark] [open|closed|prefs|prefs-sources] [query]
#   (defaults: light, open; "closed" captures the desktop without the launcher, "prefs" the preferences window;
#   a query is typed into the open launcher before the capture)
#
# With CAPTURE_INDEX=1 the file provider is enabled and answered by a stand-in
# index with made-up files (see index-service.js); never by the real one.
# CAPTURE_BACKDROP=none|light|standard sets the dimming behind the window.
# INDEX_EXTRA=<n> adds n files; CAPTURE_DOWN=<n> presses the Down arrow n times.
# CAPTURE_UP=<n> starts with made-up remembered searches and presses the Up arrow n times.
#
# Safety: the shell runs on its own D-Bus session with its own settings file in
# a temporary directory, so the real session and its settings are never touched.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT=$(realpath -m "${1:?usage: capture.sh <output.png> [light|dark]}")
case ${2:-light} in
    light) SCHEME=prefer-light ;;
    dark) SCHEME=prefer-dark ;;
    *) echo "unknown theme: $2 (use light or dark)" >&2; exit 2 ;;
esac
UUID=luciole@gor3pig.github.io

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
if [ -n "${CAPTURE_UP:-}" ]; then
    mkdir -p "$WORK/data/luciole"
    printf '{"version":1,"queries":["firefox","calculatrice","notes"]}' >"$WORK/data/luciole/queries.json"
fi
mkdir -p "$(dirname "$OUTPUT")" "$WORK/config/glib-2.0/settings" "$WORK/data/gnome-shell/extensions" "$WORK/services/dbus-1/services"
# If a stand-in were late, the bus must not start the real indexer instead.
printf '[D-BUS Service]\nName=org.freedesktop.LocalSearch3\nExec=/usr/bin/false\n' >"$WORK/services/dbus-1/services/org.freedesktop.LocalSearch3.service"
glib-compile-schemas "$ROOT/src/schemas"
ln -s "$ROOT/src" "$WORK/data/gnome-shell/extensions/$UUID"

XDG_DATA_HOME="$WORK/data" XDG_CONFIG_HOME="$WORK/config" XDG_CACHE_HOME="$WORK/cache" XDG_DATA_DIRS="$WORK/services:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}" CAPTURE_INDEX="${CAPTURE_INDEX:-0}" CAPTURE_DOWN="${CAPTURE_DOWN:-}" CAPTURE_UP="${CAPTURE_UP:-}" INDEX_EXTRA="${INDEX_EXTRA:-0}" GSETTINGS_BACKEND=keyfile \
    GSETTINGS_SCHEMA_DIR="$ROOT/src/schemas" G_MESSAGES_DEBUG=all XDG_SESSION_TYPE=wayland \
    dbus-run-session -- sh "$ROOT/tests/shell/capture-inner.sh" "$OUTPUT" "$SCHEME" "$WORK/shell.log" "${3:-open}" "${4:-}" \
    >"$WORK/out.txt" 2>&1 || true

# Set KEEP_OUTPUT=<file> to keep the whole output for debugging.
[ -z "${KEEP_OUTPUT:-}" ] || cp "$WORK/out.txt" "$KEEP_OUTPUT"

grep -E '^(captured|PASS|FAIL)' "$WORK/out.txt" || {
    echo "FAIL: no result; last lines:"
    tail -n 15 "$WORK/out.txt"
    exit 1
}
grep -q '^PASS$' "$WORK/out.txt"
