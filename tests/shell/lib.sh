# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later
# Helpers shared by the headless shell tests. Source it, do not run it.
# Must be sourced from inside the private D-Bus session started by the outer scripts.

DEST=org.gnome.Shell.Extensions
OBJ=/org/gnome/Shell/Extensions
STATE_ENABLED=1.0
STATE_DISABLED=2.0
# Log lines that mean the extension misbehaved. The temporary directories of the
# tests contain "luciole", so match the extension's own markers, not the word.
EXTENSION_ERROR_PATTERN='JS ERROR|CRITICAL.*\[Luciole\]|WARNING.*\[Luciole\]|\[Luciole\] .*(failed|error)|luciole@gor3pig\.github\.io.*(CRITICAL|rror|arning)|already disposed'

# start_shell <logfile>: starts a headless shell and stops it when the script exits.
start_shell() {
    LOG=$1
    # A name of our own for the shell's display, and the same name announced to
    # everything the private bus starts (a preferences window, a portal...): without
    # it a graphical program would fall back to the real session's display.
    WAYLAND_NAME="luciole-test-$$"
    gnome-shell --headless --wayland --no-x11 --wayland-display="$WAYLAND_NAME" --virtual-monitor 1280x720 ${SHELL_EXTRA_ARGS:-} >"$LOG" 2>&1 &
    SHELL_PID=$!
    gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
        --method org.freedesktop.DBus.UpdateActivationEnvironment "{'WAYLAND_DISPLAY': '$WAYLAND_NAME', 'DISPLAY': ''}" >/dev/null
    trap cleanup EXIT
}

cleanup() {
    [ -n "${INDEX_PID:-}" ] && kill "$INDEX_PID" 2>/dev/null
    [ -n "${KEYS_PID:-}" ] && kill "$KEYS_PID" 2>/dev/null
    [ -n "${CMD_FIFO:-}" ] && rm -f "$CMD_FIFO" "$ACK_FIFO"
    kill "$SHELL_PID" 2>/dev/null
    wait "$SHELL_PID" 2>/dev/null
}

# start_index_service: publishes a stand-in file index on the test bus (see index-service.js).
start_index_service() {
    gjs -m "$(dirname "$0")/index-service.js" >"$LOG.index" 2>&1 &
    INDEX_PID=$!
    i=0
    until grep -q 'index ready' "$LOG.index" 2>/dev/null; do
        i=$((i + 1))
        [ "$i" -gt 100 ] && fail "the stand-in file index did not start: $(cat "$LOG.index")"
        sleep 0.1
    done
}

# start_keys: starts the key helper (see keys.js) and defines send/combo/escape/typed/press.
# It holds a remote desktop session, so it must stay alive for the whole test.
start_keys() {
    CMD_FIFO=$(mktemp -u)
    ACK_FIFO=$(mktemp -u)
    mkfifo "$CMD_FIFO" "$ACK_FIFO"
    gjs -m "$(dirname "$0")/keys.js" "$CMD_FIFO" "$ACK_FIFO" &
    KEYS_PID=$!
    read -r ACK <"$ACK_FIFO"
    [ "$ACK" = ready ] || fail "the key helper did not start: $ACK"
}

send() { # send <command line for keys.js>
    printf '%s\n' "$1" >"$CMD_FIFO"
    read -r ACK <"$ACK_FIFO"
    [ "$ACK" = ok ] || fail "key helper: $ACK"
}
combo() { send combo; }
escape() { send escape; }
typed() { send "type $1"; }
pointer() { send "pointer $1 $2"; }
click() { send click; }
press() { send "key $1"; }
chord() { send "chord $1"; }

# apps_only: keeps the test on the applications provider, so it never needs the
# file index. Call it before enabling the extension.
apps_only() {
    gsettings set org.gnome.shell.extensions.luciole providers-enabled "['apps']" || fail "could not restrict the providers"
}

ext_call() {
    method=$1
    shift
    gdbus call --session --dest "$DEST" --object-path "$OBJ" --method "$DEST.$method" "$@" 2>&1
}

ext_state() {
    ext_call GetExtensionInfo "$UUID" | sed -n "s/.*'state': <\([0-9.]*\)>.*/\1/p"
}

# heap_bytes: the JavaScript heap of the shell (objects and what they own) after a forced
# garbage collection, in bytes.
# Resident memory is a poor leak detector: the collector only runs when about 40 MB of
# garbage has built up, so it rises and falls in a sawtooth. What is still alive right after
# a collection is what the code really keeps. Needs the shell started with --unsafe-mode
# (SHELL_EXTRA_ARGS), which is only done by the tests that measure memory.
heap_bytes() {
    _heap_file="${WORK:-/tmp}/heap-$$.json"
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval \
        "imports.system.gc(); imports.system.dumpMemoryInfo('$_heap_file'); 1" >/dev/null 2>&1
    # gcBytes counts the objects themselves, mallocBytes what they own (array contents, string
    # text): both are needed, a leaked array shows mostly in the second. The first occurrence of
    # each is the whole heap; the ones further down belong to a single zone.
    _gc=$(sed -n 's/^ *"gcBytes": \([0-9]*\),.*/\1/p' "$_heap_file" | head -n 1)
    _malloc=$(sed -n 's/^ *"mallocBytes": \([0-9]*\),.*/\1/p' "$_heap_file" | head -n 1)
    rm -f "$_heap_file"
    [ -n "$_gc" ] && [ -n "$_malloc" ] && echo $((_gc + _malloc))
}

# luciole_actors: how many actors of the extension (style class "luciole-...") are still in the
# scene. Needs the shell started with --unsafe-mode.
luciole_actors() {
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval \
        "(function count(actor) { return ((actor.style_class || '').includes('luciole') ? 1 : 0) + actor.get_children().reduce((sum, child) => sum + count(child), 0); })(global.stage)" \
        2>/dev/null | sed -n "s/^(true, '\\([0-9]*\\)')\$/\\1/p"
}

# shell_eval <javascript expression>: its value as text, through the shell's Eval (unsafe mode).
shell_eval() {
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "$1" \
        2>/dev/null | sed -n "s/^(true, '\\(.*\\)')\$/\\1/p" | sed 's/^"//; s/"$//'
}

# actor_geometry <style class>: "x y width height" of the first actor whose style class contains
# it, in stage coordinates, or nothing when there is none.
actor_geometry() {
    shell_eval "(function find(a) { if ((a.style_class || '').includes('$1')) { const [x, y] = a.get_transformed_position(); const [w, h] = a.get_transformed_size(); return Math.round(x) + ' ' + Math.round(y) + ' ' + Math.round(w) + ' ' + Math.round(h); } for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage)"
}

rss_kb() {
    awk '/^VmRSS:/ {print $2}' "/proc/$SHELL_PID/status"
}

fail() {
    echo "FAIL: $1"
    echo "---- extension lines and errors from the shell log ----"
    grep -E 'Luciole|JS ERROR|CRITICAL' "$LOG" | tail -n 15
    echo "---- last lines of the shell log ----"
    tail -n 6 "$LOG"
    exit 1
}

# wait_ext_state <wanted>: polls for up to 10 s.
wait_ext_state() {
    i=0
    while [ "$i" -lt 100 ]; do
        [ "$(ext_state)" = "$1" ] && return 0
        sleep 0.1
        i=$((i + 1))
    done
    return 1
}

# wait_for_extension: waits until the shell lists $UUID (it answers with a state).
wait_for_extension() {
    i=0
    until [ -n "$(ext_state)" ]; do
        i=$((i + 1))
        [ "$i" -gt 200 ] && fail "the shell never listed $UUID"
        kill -0 "$SHELL_PID" 2>/dev/null || fail "the shell exited during startup"
        sleep 0.1
    done
}

# make_control_extension <data dir> <uuid>: an extension that does nothing, used
# as a baseline because GNOME Shell itself grows a little with every cycle.
make_control_extension() {
    dir="$1/gnome-shell/extensions/$2"
    mkdir -p "$dir"
    printf '{"uuid":"%s","name":"Control","description":"empty","shell-version":["50","51"]}\n' "$2" >"$dir/metadata.json"
    printf 'import {Extension} from "resource:///org/gnome/shell/extensions/extension.js";\nexport default class Control extends Extension { enable() {} disable() {} }\n' >"$dir/extension.js"
}
