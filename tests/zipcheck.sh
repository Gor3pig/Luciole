#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later

# Builds the package and checks what is inside: every file the extension needs
# is there, nothing it should not ship is, and no private detail of the machine
# or the user leaked into any file.
#
#   sh tests/zipcheck.sh
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 1
UUID=$(sed -n 's/.*"uuid": "\(.*\)".*/\1/p' src/metadata.json)
ZIP="dist/$UUID.shell-extension.zip"

make pack >/dev/null 2>&1 || { echo "FAIL: make pack failed"; exit 1; }
[ -s "$ZIP" ] || { echo "FAIL: $ZIP was not built"; exit 1; }
FILES=$(unzip -Z1 "$ZIP" | grep -v '/$' | sort)

fail=0
for needed in metadata.json extension.js prefs.js stylesheet.css stylesheet-dark.css \
    luciole-128x128.png schemas/org.gnome.shell.extensions.luciole.gschema.xml locale/fr/LC_MESSAGES/luciole.mo \
    locale/en/LC_MESSAGES/luciole.mo core/session.js ui/launcher.js providers/files.js shell/compat.js; do
    echo "$FILES" | grep -qx "$needed" || { echo "FAIL: $needed is missing from the package"; fail=1; }
done

# Every .js file of the source tree must be in the package (a forgotten directory breaks the extension).
for source in $(cd src && find . -name '*.js' -not -path './locale/*' | sed 's#^\./##' | sort); do
    echo "$FILES" | grep -qx "$source" || { echo "FAIL: $source is not in the package"; fail=1; }
done

# Nothing that must not ship. (Only the 128 px icon goes in: the other sizes stay in the repository.)
echo "$FILES" | grep -E 'luciole-[0-9]+x[0-9]+\.png' | grep -vx 'luciole-128x128.png' && { echo "FAIL: an icon size that should not ship is in the package"; fail=1; }
echo "$FILES" | grep -E 'gschemas\.compiled|\.pot$|\.po$|node_modules|\.git' && { echo "FAIL: unexpected files in the package"; fail=1; }

# No private detail of the build machine: user name and host name. (Forbidden words are
# checked on the sources by the repository hooks, before they can enter a package.)
USER_NAME=$(id -un)
HOST_NAME=$(hostname)
SCRATCH=$(mktemp -d)
trap 'rmdir "$SCRATCH" 2>/dev/null' EXIT
for file in $FILES; do
    unzip -p "$ZIP" "$file" 2>/dev/null | strings >"$SCRATCH/content" || true
    if grep -qiE "$USER_NAME|$HOST_NAME" "$SCRATCH/content"; then
        echo "FAIL: a private detail appears in $file"
        grep -iE "$USER_NAME|$HOST_NAME" "$SCRATCH/content" | head -2
        fail=1
    fi
done
rm -f "$SCRATCH/content"

# The schema must compile strictly, as the shell does when it installs the package.
COPY=$(mktemp -d)
unzip -qo "$ZIP" 'schemas/*' -d "$COPY"
glib-compile-schemas --strict "$COPY/schemas" || { echo "FAIL: the schema does not compile"; fail=1; }
rm -f "$COPY"/schemas/* && rmdir "$COPY/schemas" "$COPY"

[ "$fail" -eq 0 ] && echo "package OK: $(echo "$FILES" | wc -l) files"
exit "$fail"
