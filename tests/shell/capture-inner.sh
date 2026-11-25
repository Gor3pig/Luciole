#!/bin/sh
# Runs inside the private D-Bus session started by capture.sh. Do not call directly.
set -u

OUTPUT=$1
SCHEME=$2
LOG_FILE=$3
STATE=${4:-open}
QUERY=${5:-}
UUID=luciole@luciole.dev
. "$(dirname "$0")/lib.sh"

start_shell "$LOG_FILE"
wait_for_extension

gsettings set org.gnome.shell.extensions.luciole debug-timings true || fail "could not set debug-timings"
gsettings set org.gnome.desktop.interface color-scheme "$SCHEME" || fail "could not set the colour scheme"
ext_call EnableExtension "$UUID" >/dev/null
wait_ext_state "$STATE_ENABLED" || fail "extension not ENABLED (state=$(ext_state))"
sleep 1

start_keys

# The shell starts in the overview: show the plain desktop instead.
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.freedesktop.DBus.Properties.Set org.gnome.Shell OverviewActive '<false>' >/dev/null 2>&1
sleep 1

if [ "$STATE" = open ]; then
    combo
    i=0
    until grep -q '\[Luciole\] opened' "$LOG"; do
        i=$((i + 1))
        [ "$i" -gt 100 ] && fail "the launcher did not open"
        sleep 0.05
    done
    if [ -n "$QUERY" ]; then
        typed "$QUERY"
        i=0
        until grep -qF "query=$QUERY" "$LOG"; do
            i=$((i + 1))
            [ "$i" -gt 100 ] && fail "no results for the query"
            sleep 0.05
        done
    fi
fi
sleep 1 # let animations finish

gjs -m "$(dirname "$0")/capture.js" "$OUTPUT" || fail "the capture failed"
[ -s "$OUTPUT" ] || fail "the capture file is empty"
echo "captured $OUTPUT"
echo "PASS"
