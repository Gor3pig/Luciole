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
# A process of the test shell may still be writing there for a moment after it exits.
trap 'rm -rf "$WORK" 2>/dev/null || { sleep 1; rm -rf "$WORK"; }' EXIT

glib-compile-schemas "$ROOT/src/schemas"
mkdir -p "$WORK/config/glib-2.0/settings" "$WORK/data/gnome-shell/extensions" "$WORK/data/applications" \
    "$WORK/services/dbus-1/services"
ln -s "$ROOT/src" "$WORK/data/gnome-shell/extensions/$UUID"

cat >"$WORK/data/applications/luciole-test-facture.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Facture Express
Exec=true
Actions=new-test;

[Desktop Action new-test]
Name=Nouvelle fenetre de test
Exec=true
DESKTOP
# A Settings panel of our own (the name pattern is the real panels'): opening it must run this.
cat >"$WORK/data/applications/gnome-luciole-test-panel.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Panneau Luciole de test
Keywords=lucioletest;
Exec=touch $WORK/panel-ran
NoDisplay=true
DESKTOP
# An application of our own that opens text files: "Open With" must not depend on the editors the
# machine has installed.
cat >"$WORK/data/applications/luciole-test-reader.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Lecteur Luciole de test
Exec=true %f
MimeType=text/plain;
DESKTOP
# GIO finds which applications open a type through this index, written when an application is installed.
printf '[MIME Cache]\ntext/plain=luciole-test-reader.desktop;\n' >"$WORK/data/applications/mimeinfo.cache"
# A file that really exists, in the stand-in index, to ask which applications open it.
mkdir -p "$WORK/docs"
printf 'a test file\n' >"$WORK/docs/rapport-test.txt"
export INDEX_REAL_FILE="$WORK/docs/rapport-test.txt"
# The file manager is a stand-in too, started by the bus when asked: it notes what it is asked to
# show (in FILEMANAGER_RECORD) and opens nothing; the real one is never started.
export FILEMANAGER_RECORD="$WORK/shown.txt"
# A stand-in terminal, first in the PATH the shell searches: it writes down how it was asked to
# open (its arguments, one per line) instead of opening a window.
mkdir -p "$WORK/bin"
export TERMINAL_RECORD="$WORK/terminal.txt"
cat >"$WORK/bin/ptyxis" <<TERMINAL
#!/bin/sh
printf '%s\\n' "\$@" >"$TERMINAL_RECORD"
TERMINAL
chmod +x "$WORK/bin/ptyxis"
export PATH="$WORK/bin:$PATH"
cat >"$WORK/services/dbus-1/services/org.freedesktop.FileManager1.service" <<SERVICE
[D-BUS Service]
Name=org.freedesktop.FileManager1
Exec=/usr/bin/gjs -m $ROOT/tests/shell/filemanager-service.js $WORK/shown.txt
SERVICE
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
[ -z "${KEEP_OUTPUT:-}" ] || { cp "$WORK/out.txt" "$KEEP_OUTPUT"; cp "$WORK/shell.log" "$KEEP_OUTPUT.shell.log"; }

grep -E '^(ok:|FAIL|PASS|preview|keystroke to|log lines|----)|\[Luciole\]|JS ERROR|CRITICAL' "$WORK/out.txt" | grep -vE 'DEBUG.*\[Luciole\] (perf|results|apps index|opened|closed|enabled|search ready)' || true
grep -q '^PASS$' "$WORK/out.txt"
