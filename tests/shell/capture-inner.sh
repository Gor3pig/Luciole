#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later
# Runs inside the private D-Bus session started by capture.sh. Do not call directly.
set -u

OUTPUT=$1
SCHEME=$2
LOG_FILE=$3
STATE=${4:-open}
QUERY=${5:-}
UUID=luciole@gor3pig.github.io
. "$(dirname "$0")/lib.sh"

start_shell "$LOG_FILE"
wait_for_extension

gsettings set org.gnome.shell.extensions.luciole debug-timings true || fail "could not set debug-timings"
gsettings set org.gnome.desktop.interface color-scheme "$SCHEME" || fail "could not set the colour scheme"
[ -z "${CAPTURE_MAX:-}" ] || gsettings set org.gnome.shell.extensions.luciole max-results "$CAPTURE_MAX" || fail "could not set the number of results"
if [ "${CAPTURE_PLAIN:-0}" = 1 ]; then
    gsettings set org.gnome.desktop.background picture-options none || fail "could not remove the wallpaper"
    gsettings set org.gnome.desktop.background primary-color '#3a5a8c'
    gsettings set org.gnome.desktop.background color-shading-type solid
fi
[ -z "${CAPTURE_BACKDROP:-}" ] || gsettings set org.gnome.shell.extensions.luciole backdrop "$CAPTURE_BACKDROP" || fail "could not set the backdrop"
if [ "${CAPTURE_INDEX:-0}" = 1 ]; then
    start_index_service
else
    apps_only
fi
ext_call EnableExtension "$UUID" >/dev/null
wait_ext_state "$STATE_ENABLED" || fail "extension not ENABLED (state=$(ext_state))"
sleep 1

start_keys

# The shell starts in the overview: show the plain desktop instead.
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.freedesktop.DBus.Properties.Set org.gnome.Shell OverviewActive '<false>' >/dev/null 2>&1
sleep 1

if [ "$STATE" = prefs ] || [ "$STATE" = prefs-sources ]; then
    # The shell starts the preferences window of the extension, as it does for a user.
    ext_call LaunchExtensionPrefs "$UUID" >/dev/null || fail "the preferences could not be launched"
    sleep 6
    # Reach the page switcher with Shift+Tab, then move to the next page with the arrow key.
    if [ "$STATE" = prefs-sources ]; then
        press ISO_Left_Tab
        press ISO_Left_Tab
        press Right
        press Return
        sleep 2
    fi
fi

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
if [ -n "${CAPTURE_CHORD:-}" ]; then
    chord "$CAPTURE_CHORD"
    sleep 1
fi
if [ -n "${CAPTURE_UP:-}" ]; then
    n=$CAPTURE_UP
    while [ "$n" -gt 0 ]; do
        press Up
        n=$((n - 1))
    done
    sleep 1
fi
if [ -n "${CAPTURE_DOWN:-}" ]; then
    n=$CAPTURE_DOWN
    while [ "$n" -gt 0 ]; do
        press Down
        n=$((n - 1))
    done
    sleep 1
fi
sleep 1 # let animations finish

# CAPTURE_CROP=1: only the window of Luciole, with a margin of the desktop around it (no top bar).
CROP=""
if [ "${CAPTURE_CROP:-0}" = 1 ]; then
    set -- $(actor_geometry luciole-panel)
    [ "$#" = 4 ] || fail "CAPTURE_CROP: the window of Luciole was not found"
    # 40 px of desktop around the window; the frame is the 1280x720 virtual monitor.
    CROP=$(awk -v x="$1" -v y="$2" -v w="$3" -v h="$4" 'BEGIN { m = 40; l = x - m; t = y - m; r = 1280 - (x + w) - m; b = 720 - (y + h) - m;
        printf "%d %d %d %d", (l > 0 ? l : 0), (t > 0 ? t : 0), (r > 0 ? r : 0), (b > 0 ? b : 0) }')
fi
# shellcheck disable=SC2086
gjs -m "$(dirname "$0")/capture.js" "$OUTPUT" Meta-0 $CROP 2>"$LOG.capture" || fail "the capture failed: $(tail -n 3 "$LOG.capture")"
[ -s "$OUTPUT" ] || fail "the capture file is empty"
echo "captured $OUTPUT"
echo "PASS"
