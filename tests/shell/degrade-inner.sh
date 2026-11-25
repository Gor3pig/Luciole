#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later
# Runs inside the private D-Bus session started by degrade.sh. Do not call directly.
set -u

WORK=$1
LOG_FILE=$2
UUID=luciole@gor3pig.github.io
. "$(dirname "$0")/lib.sh"

start_shell "$LOG_FILE"
wait_for_extension
gsettings set org.gnome.shell.extensions.luciole debug-timings true || fail "could not set debug-timings"
# Providers stay at their defaults: applications and files.
ext_call EnableExtension "$UUID" >/dev/null
wait_ext_state "$STATE_ENABLED" || fail "extension not ENABLED (state=$(ext_state))"
start_keys

wait_log() { # wait_log <fixed text> [count] [seconds]
    i=0
    while [ "$i" -lt $((${3:-5} * 20)) ]; do
        [ "$(grep -cF "$1" "$LOG")" -ge "${2:-1}" ] && return 0
        sleep 0.05
        i=$((i + 1))
    done
    return 1
}

wait_log "search ready: apps, files" || fail "both providers did not start"
combo
wait_log "[Luciole] opened" || fail "the launcher did not open"
typed fiche
wait_log "first=Fiche Zèbre query=fiche" 1 8 || fail "applications stopped working without the file index"
echo "ok: applications still answer while the file index is missing"
wait_log "file search is unavailable" 1 8 || fail "the missing file index was not reported"
typed zeb
wait_log "query=fichezeb" 1 || fail "no answer to the next keystrokes"
sleep 1
WARNINGS=$(grep -cF "file search is unavailable" "$LOG")
[ "$WARNINGS" = 1 ] || fail "the missing index was reported $WARNINGS times instead of once"
echo "ok: the problem is reported once, not at every keystroke"

# Anything else wrong with the extension would show up as an error line.
ERRORS=$(grep -iE "$EXTENSION_ERROR_PATTERN" "$LOG" | grep -vcF "file search is unavailable" || true)
echo "log lines mentioning an error about the extension: $ERRORS"
[ "$ERRORS" = 0 ] || { grep -iE "$EXTENSION_ERROR_PATTERN" "$LOG" | head; fail "errors found in the shell log"; }
echo "PASS"
