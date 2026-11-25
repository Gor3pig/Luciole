#!/bin/sh
# Takes a PNG screenshot of the open launcher inside a private, headless GNOME
# Shell: no real desktop is captured.
#
#   sh tests/shell/capture.sh <output.png> [light|dark] [open|closed] [query]
#   (defaults: light, open; "closed" captures the desktop without the launcher;
#   a query is typed into the open launcher before the capture)
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
UUID=luciole@luciole.dev

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$(dirname "$OUTPUT")" "$WORK/config/glib-2.0/settings" "$WORK/data/gnome-shell/extensions"
glib-compile-schemas "$ROOT/src/schemas"
ln -s "$ROOT/src" "$WORK/data/gnome-shell/extensions/$UUID"

XDG_DATA_HOME="$WORK/data" XDG_CONFIG_HOME="$WORK/config" GSETTINGS_BACKEND=keyfile \
    GSETTINGS_SCHEMA_DIR="$ROOT/src/schemas" G_MESSAGES_DEBUG=all XDG_SESSION_TYPE=wayland \
    dbus-run-session -- sh "$ROOT/tests/shell/capture-inner.sh" "$OUTPUT" "$SCHEME" "$WORK/shell.log" "${3:-open}" "${4:-}" \
    >"$WORK/out.txt" 2>&1 || true

grep -E '^(captured|PASS|FAIL)' "$WORK/out.txt" || {
    echo "FAIL: no result; last lines:"
    tail -n 15 "$WORK/out.txt"
    exit 1
}
grep -q '^PASS$' "$WORK/out.txt"
