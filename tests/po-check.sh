#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later

# Every translation file must compile and leave nothing untranslated or fuzzy, and the template
# must already hold every text of the source (so a new text is not forgotten in the .po files).
#
#   sh tests/po-check.sh
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 1
fail=0

for po in src/po/*.po; do
    stats=$(LC_ALL=C msgfmt --check --statistics -o /dev/null "$po" 2>&1) || { echo "FAIL: $po does not compile: $stats"; fail=1; continue; }
    case "$stats" in
        *untranslated*|*fuzzy*) echo "FAIL: $po is incomplete: $stats"; fail=1 ;;
        *) echo "$po: $stats" ;;
    esac
done

# The template, regenerated from the sources, must not differ from the committed one
# apart from its creation date.
TMP=$(mktemp)
A=$(mktemp)
B=$(mktemp)
trap 'rm -f "$TMP" "$A" "$B"' EXIT
xgettext --from-code=UTF-8 --language=JavaScript --keyword=_ --add-comments=Translators \
    --add-location=file --package-name=luciole --msgid-bugs-address= -o "$TMP" \
    $(find src -name '*.js' -not -path 'src/locale/*' | sort) 2>/dev/null
grep -v '^"POT-Creation-Date' "$TMP" >"$A"
grep -v '^"POT-Creation-Date' src/po/luciole.pot >"$B"
if ! diff -q "$A" "$B" >/dev/null 2>&1; then
    echo "FAIL: src/po/luciole.pot is out of date: run make po"
    fail=1
fi
exit "$fail"
