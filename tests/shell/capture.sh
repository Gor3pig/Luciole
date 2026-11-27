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
# INDEX_DEMO=en|fr uses made-up everyday files instead (README screenshots). INDEX_EXTRA=<n> adds n files; CAPTURE_DOWN=<n> presses the Down arrow n times.
# CAPTURE_CHORD=<keys> sends a key chord once the window is open and the query typed (Control_L+2).
# CAPTURE_UP=<n> starts with made-up remembered searches and presses the Up arrow n times.
# CAPTURE_CROP=1 keeps only the window of Luciole and a margin around it.
# CAPTURE_LANG=en_US.UTF-8 shows the interface in another language (French by default).
# CAPTURE_PLAIN=1 puts a plain background behind the window (no wallpaper).
# CAPTURE_MAX=<n> shows at most n results per source.
# CAPTURE_GNOME_APPS=1 lists only GNOME's own applications (see below).
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
# A process of the test shell may still be writing there for a moment after it exits.
trap 'rm -rf "$WORK" 2>/dev/null || { sleep 1; rm -rf "$WORK"; }' EXIT
if [ -n "${CAPTURE_UP:-}" ]; then
    mkdir -p "$WORK/data/luciole"
    printf '{"version":1,"queries":["firefox","calculatrice","notes"]}' >"$WORK/data/luciole/queries.json"
fi
mkdir -p "$(dirname "$OUTPUT")" "$WORK/config/glib-2.0/settings" "$WORK/data/gnome-shell/extensions" "$WORK/services/dbus-1/services"
# If a stand-in were late, the bus must not start the real indexer instead.
printf '[D-BUS Service]\nName=org.freedesktop.LocalSearch3\nExec=/usr/bin/false\n' >"$WORK/services/dbus-1/services/org.freedesktop.LocalSearch3.service"
glib-compile-schemas "$ROOT/src/schemas"
ln -s "$ROOT/src" "$WORK/data/gnome-shell/extensions/$UUID"
# CAPTURE_GNOME_APPS=1: only GNOME's own applications and Settings panels are listed, so a public
# screenshot does not show what this machine has installed. An application of the same name in the
# test's private folder that says Hidden=true hides the one of the system.
if [ "${CAPTURE_GNOME_APPS:-0}" = 1 ]; then
    mkdir -p "$WORK/data/applications"
    for dir in $(echo "${XDG_DATA_DIRS:-/usr/local/share:/usr/share}" | tr ':' ' '); do
        for file in "$dir"/applications/*.desktop; do
            [ -e "$file" ] || continue
            name=${file##*/}
            case "$name" in
                org.gnome.*.desktop | gnome-*-panel.desktop | yelp.desktop) ;;
                *) printf '[Desktop Entry]\nType=Application\nName=hidden\nHidden=true\n' >"$WORK/data/applications/$name" ;;
            esac
        done
    done
fi

XDG_DATA_HOME="$WORK/data" XDG_CONFIG_HOME="$WORK/config" XDG_CACHE_HOME="$WORK/cache" XDG_DATA_DIRS="$WORK/services:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}" CAPTURE_INDEX="${CAPTURE_INDEX:-0}" CAPTURE_DOWN="${CAPTURE_DOWN:-}" CAPTURE_UP="${CAPTURE_UP:-}" CAPTURE_CHORD="${CAPTURE_CHORD:-}" CAPTURE_CROP="${CAPTURE_CROP:-0}" CAPTURE_PLAIN="${CAPTURE_PLAIN:-0}" LUCIOLE_TEST_LANG="${CAPTURE_LANG:-}" SHELL_EXTRA_ARGS="$([ "${CAPTURE_CROP:-0}" = 1 ] && echo --unsafe-mode || true)" INDEX_EXTRA="${INDEX_EXTRA:-0}" INDEX_DEMO="${INDEX_DEMO:-}" CAPTURE_MAX="${CAPTURE_MAX:-}" GSETTINGS_BACKEND=keyfile \
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
