#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later
# Runs inside the private D-Bus session started by openclose.sh. Do not call directly.
set -u

NAME=$1
ENABLE=$2
CYCLES=$3
UUID=$4
LOG_FILE=$5
. "$(dirname "$0")/lib.sh"

SCHEMA=org.gnome.shell.extensions.luciole
# Budget for the synchronous part of opening the launcher (ms). The first open
# builds the actors, so it is the slowest.
OPEN_BUDGET_MS=50
# Growth allowed for what the JavaScript heap keeps alive after a collection, over the cycles
# that follow the warm-up (measured: about 110 kB, a fixed cost; this catches a leak of a few kB per cycle).
MAX_HEAP_GROWTH=262144

start_shell "$LOG_FILE"
wait_for_extension

if [ "$ENABLE" = 1 ]; then
    gsettings set "$SCHEMA" debug-timings true || fail "could not set debug-timings"
    apps_only
    ext_call EnableExtension "$UUID" >/dev/null
    wait_ext_state "$STATE_ENABLED" || fail "extension not ENABLED (state=$(ext_state))"
fi

start_keys
count() { grep -c "\[Luciole\] $1" "$LOG" || true; }
wait_count() { # wait_count <message> <at least n>: polls for up to 5 s
    i=0
    while [ "$i" -lt 100 ]; do
        [ "$(count "$1")" -ge "$2" ] && return 0
        sleep 0.05
        i=$((i + 1))
    done
    return 1
}

WARM_UP=$((CYCLES / 4))
HEAP_START=""
n=1
while [ "$n" -le "$CYCLES" ]; do
    combo
    if [ "$ENABLE" = 1 ]; then
        wait_count 'opened' "$n" || fail "cycle $n: the launcher did not open"
        escape
        wait_count 'closed' "$n" || fail "cycle $n: the launcher did not close on Escape"
    else
        sleep 0.15
        escape
    fi
    kill -0 "$SHELL_PID" 2>/dev/null || fail "cycle $n: the shell died"
    [ "$n" -eq "$WARM_UP" ] && HEAP_START=$(heap_bytes)
    [ $((n % 10)) -eq 0 ] && rss_kb >>"$LOG.rss"
    n=$((n + 1))
done

# What the code keeps alive after a collection, from the end of the warm-up to the end of the
# cycles. (Resident size is a sawtooth, the collector runs late: it is printed, not judged.)
HEAP_END=$(heap_bytes)
if [ "$ENABLE" = 1 ]; then
    [ -n "$HEAP_START" ] && [ -n "$HEAP_END" ] || fail "the JavaScript heap could not be measured (need at least 8 cycles)"
    echo "JavaScript heap after garbage collection: ${HEAP_START} bytes after warm-up, ${HEAP_END} bytes at the end, growth $((HEAP_END - HEAP_START)) bytes (limit ${MAX_HEAP_GROWTH})"
    [ $((HEAP_END - HEAP_START)) -le "$MAX_HEAP_GROWTH" ] || fail "opening and closing keeps growing what the shell holds"
fi

LAST_RSS=$(rss_kb)
echo "$CYCLES open/close cycles done, shell alive"
# One sample every 10 cycles. A shell warms up (caches, JavaScript heap) before its
# memory settles, so a total growth says little. A leak keeps growing, so what counts
# is the growth in the second half of the run, once the curve should be flat.
SAMPLES=$(wc -l <"$LOG.rss")
if [ "$SAMPLES" -ge 4 ]; then
    MIDDLE=$(sed -n "$(((SAMPLES + 1) / 2))p" "$LOG.rss")
    echo "resident memory samples (kB): $(tr '\n' ' ' <"$LOG.rss")"
    echo "resident growth (information only): $((LAST_RSS - MIDDLE)) kB"
fi

if [ "$ENABLE" = 1 ]; then
    # Timing of the synchronous part of opening.
    grep 'perf open:' "$LOG" | sed -n 's/.*perf open: \([0-9.]*\) ms.*/\1/p' >"$LOG.open"
    FIRST=$(head -n 1 "$LOG.open")
    MAX=$(sort -n "$LOG.open" | tail -n 1)
    echo "opening time (handler only, not the compositor frame): first ${FIRST} ms, worst ${MAX} ms, budget ${OPEN_BUDGET_MS} ms"
    awk -v max="$MAX" -v budget="$OPEN_BUDGET_MS" 'BEGIN { exit !(max + 0 <= budget + 0) }' ||
        fail "opening is slower than the ${OPEN_BUDGET_MS} ms budget"

    # The shortcut is a toggle: pressed again while the launcher is open, it closes it.
    OPENED=$(count opened)
    CLOSED=$(count closed)
    combo
    wait_count 'opened' $((OPENED + 1)) || fail "toggle: the launcher did not open"
    combo
    wait_count 'closed' $((CLOSED + 1)) || fail "toggle: the shortcut did not close the open launcher"
    echo "toggle: the shortcut closes the open launcher"

    # Pointer clicks: anywhere but the panel closes the launcher (the empty window, the top
    # bar, a corner); a click on the text field does not. The test monitor is 1280x720, so the
    # panel is the strip around x 329-951, y 180-258 (a quarter of the way down).
    for spot in "640 650" "100 300" "640 8" "3 3" "1200 300"; do
        OPENED=$(count opened)
        CLOSED=$(count closed)
        combo
        wait_count 'opened' $((OPENED + 1)) || fail "click ($spot): the launcher did not open"
        pointer $spot
        sleep 0.2
        click
        wait_count 'closed' $((CLOSED + 1)) || fail "click outside the panel at $spot did not close the launcher"
        sleep 0.3
    done
    # Inside the panel: on the text field, and on the panel's own margin next to it (the field
    # takes the click itself, so only the margin proves the window leaves panel clicks alone).
    OPENED=$(count opened)
    CLOSED=$(count closed)
    combo
    wait_count 'opened' $((OPENED + 1)) || fail "click inside: the launcher did not open"
    sleep 0.3
    set -- $(actor_geometry luciole-panel)
    PANEL_X=$1
    PANEL_Y=$2
    PANEL_W=$3
    set -- $(actor_geometry luciole-entry)
    ENTRY_X=$1
    ENTRY_Y=$2
    MARGIN_X=$((PANEL_X + (ENTRY_X - PANEL_X) / 2))
    [ "$MARGIN_X" -gt "$PANEL_X" ] && [ "$MARGIN_X" -lt "$ENTRY_X" ] ||
        fail "the margin of the panel is too thin to click (panel x=$PANEL_X, field x=$ENTRY_X)"
    for spot in "$((ENTRY_X + 40)) $((ENTRY_Y + 10))" "$MARGIN_X $((ENTRY_Y + 10))" "$((PANEL_X + PANEL_W / 2)) $((PANEL_Y + 2))"; do
        pointer $spot
        sleep 0.2
        click
        sleep 0.6
        [ "$(count closed)" = "$CLOSED" ] || fail "a click inside the panel at $spot closed the launcher"
    done
    escape
    wait_count 'closed' $((CLOSED + 1)) || fail "click inside: Escape did not close the launcher afterwards"
    echo "clicks: outside the panel closes, inside the panel does not"

    # The search field takes at most 256 characters, however much is typed or pasted.
    OPENED=$(count opened)
    CLOSED=$(count closed)
    combo
    wait_count 'opened' $((OPENED + 1)) || fail "length: the launcher did not open"
    LONG=$(printf 'abcdefghij%.0s' $(seq 1 30))
    typed "$LONG"
    sleep 1
    LENGTH=$(entry_text_length)
    [ "$LENGTH" = 256 ] || fail "the search field took $LENGTH characters out of the 300 typed (expected 256)"
    escape
    escape
    wait_count 'closed' $((CLOSED + 1)) || fail "length: the launcher did not close"
    echo "length: the search field is capped at 256 characters"

    # Super and Alt+Tab mean "I am going elsewhere": the shell ignores them while the
    # launcher holds the keyboard, so the launcher closes (and the keys then work again).
    for leave in "key Super_L" "chord Alt_L+Tab"; do
        OPENED=$(count opened)
        CLOSED=$(count closed)
        combo
        wait_count 'opened' $((OPENED + 1)) || fail "leave ($leave): the launcher did not open"
        send "$leave"
        wait_count 'closed' $((CLOSED + 1)) || fail "leave ($leave): the launcher stayed open"
        sleep 0.5
        # Super may have opened the overview: leave it.
        escape
        sleep 0.5
    done
    OPENED=$(count opened)
    CLOSED=$(count closed)
    combo
    wait_count 'opened' $((OPENED + 1)) || fail "leave keys: the launcher does not open again afterwards"
    escape
    wait_count 'closed' $((CLOSED + 1)) || fail "leave keys: the launcher does not close on Escape afterwards"
    echo "leave keys: Super and Alt+Tab close the launcher, and it works again afterwards"

    # Whatever takes the keyboard away (here the overview, opened from outside the
    # keyboard path), the launcher closes: nothing typed would reach it any more.
    OPENED=$(count opened)
    CLOSED=$(count closed)
    combo
    wait_count 'opened' $((OPENED + 1)) || fail "focus: the launcher did not open"
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.freedesktop.DBus.Properties.Set \
        org.gnome.Shell OverviewActive '<true>' >/dev/null 2>&1 || fail "focus: could not open the overview"
    wait_count 'keyboard focus left' 1 || fail "focus: the launcher did not notice the keyboard going elsewhere"
    wait_count 'closed' $((CLOSED + 1)) || fail "focus: the launcher stayed open"
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.freedesktop.DBus.Properties.Set \
        org.gnome.Shell OverviewActive '<false>' >/dev/null 2>&1 || true
    sleep 0.7
    echo "focus: the launcher closes when something else takes the keyboard"

    # Disabling the extension while the launcher is open must release the keyboard
    # and free the shortcut; re-enabling must then work normally.
    OPENED=$(count opened)
    combo
    wait_count 'opened' $((OPENED + 1)) || fail "the launcher did not open before the disable test"
    [ "$(luciole_actors)" -gt 0 ] || fail "the actor check is blind: no actor of the extension found while the launcher is open"
    ext_call DisableExtension "$UUID" >/dev/null
    wait_ext_state "$STATE_DISABLED" || fail "disable while open: not DISABLED (state=$(ext_state))"
    OPENED=$(count opened)
    combo
    sleep 0.5
    [ "$(count opened)" = "$OPENED" ] || fail "the shortcut still works after the extension was disabled"
    [ "$(luciole_actors)" = 0 ] || fail "disable: actors of the extension are still in the scene ($(luciole_actors))"
    echo "disable while open: clean, the shortcut is freed, no actor is left in the scene"
    ext_call EnableExtension "$UUID" >/dev/null
    wait_ext_state "$STATE_ENABLED" || fail "re-enable: not ENABLED (state=$(ext_state))"
    CLOSED=$(count closed)
    combo
    wait_count 'opened' $((OPENED + 1)) || fail "the launcher did not open after re-enabling"
    escape
    wait_count 'closed' $((CLOSED + 1)) || fail "the launcher did not close after re-enabling"

    # The style follows the session while it runs: dark, light, then dark again (the shell reloads
    # an extension's stylesheet only if its name says which style it is for).
    panel_bg() {
        shell_eval "(function find(a) { if ((a.style_class || '').includes('luciole-panel')) { const c = a.get_theme_node().get_background_color(); return (c.red + c.green + c.blue > 382 ? 'light' : 'dark') + ' ' + [c.red, c.green, c.blue, c.alpha].join(','); } for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage)"
    }
    style_now() { # style_now <color-scheme>: the style Luciole's window shows under it
        gsettings set org.gnome.desktop.interface color-scheme "$1" >/dev/null 2>&1
        sleep 0.8
        OPENED=$(count opened)
        combo
        wait_count 'opened' $((OPENED + 1)) || fail "style: the launcher did not open"
        sleep 0.3
        STYLE=$(panel_bg)
        CLOSED=$(count closed)
        escape
        wait_count 'closed' $((CLOSED + 1)) || fail "style: the launcher did not close"
        echo "$STYLE"
    }
    S1=$(style_now prefer-dark); case "$S1" in dark\ *) ;; *) fail "style: not dark in the dark style ($S1)" ;; esac
    S2=$(style_now prefer-light); case "$S2" in light\ *) ;; *) fail "style: not light after switching to the light style ($S2)" ;; esac
    S3=$(style_now prefer-dark); case "$S3" in dark\ *) ;; *) fail "style: still light after switching back to the dark style ($S3)" ;; esac
    gsettings reset org.gnome.desktop.interface color-scheme >/dev/null 2>&1
    echo "style: follows dark, light and dark again while the session runs"

    # Screen lock: an open launcher closes, and the shortcut does nothing while locked.
    LOCK_HINT_BEFORE=$(busctl get-property org.freedesktop.login1 /org/freedesktop/login1/session/auto \
        org.freedesktop.login1.Session LockedHint 2>&1)
    OPENED=$(count opened)
    CLOSED=$(count closed)
    DISABLINGS=$(count disabling)
    combo
    wait_count 'opened' $((OPENED + 1)) || fail "the launcher did not open before the lock test"
    gdbus call --session --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver \
        --method org.gnome.ScreenSaver.Lock >/dev/null || fail "could not lock the screen"
    sleep 1
    if ! gdbus call --session --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver \
        --method org.gnome.ScreenSaver.GetActive 2>&1 | grep -q true; then
        # Without a login session (a container, say) the shell cannot lock the screen at
        # all. Only that exact situation is reported as "not exercised"; anywhere else a
        # screen that does not lock is a failure.
        if grep -q 'Could not get proxy for session' "$LOG"; then
            echo "screen lock: NOT EXERCISED, this environment has no login session so the screen cannot lock"
            LOCK_SKIPPED=1
        else
            fail "the screen did not lock"
        fi
    fi
    if [ -z "${LOCK_SKIPPED:-}" ]; then
        # Locking either closes the launcher or, in shells that switch extensions off while
        # the lock screen is shown, disables the extension, which destroys the launcher.
        i=0
        until [ "$(count closed)" -ge $((CLOSED + 1)) ] || [ "$(count disabling)" -ge $((DISABLINGS + 1)) ]; do
            i=$((i + 1))
            [ "$i" -gt 100 ] && fail "the launcher stayed open after the screen locked"
            sleep 0.05
        done
        OPENED=$(count opened)
        combo
        sleep 1
        [ "$(count opened)" = "$OPENED" ] || fail "the launcher opened on a locked screen"
        echo "screen lock: the open launcher closed, and the shortcut is ignored while locked"
    fi
    # The nested shell told logind that its session is locked: put it back.
    busctl call org.freedesktop.login1 /org/freedesktop/login1/session/auto \
        org.freedesktop.login1.Session SetLockedHint b false >/dev/null 2>&1 || true
    echo "logind LockedHint before: ${LOCK_HINT_BEFORE}; after restore: $(busctl get-property org.freedesktop.login1 \
        /org/freedesktop/login1/session/auto org.freedesktop.login1.Session LockedHint 2>&1)"
fi

ERRORS=$(grep -ciE "$EXTENSION_ERROR_PATTERN" "$LOG" || true)
echo "log lines mentioning an error about the extension or a disposed object: $ERRORS"
if [ "$ERRORS" -gt 0 ]; then
    grep -iE "$EXTENSION_ERROR_PATTERN" "$LOG" | head -20
    fail "errors found in the shell log"
fi

echo "PASS"
