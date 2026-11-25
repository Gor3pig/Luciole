# Helpers shared by the headless shell tests. Source it, do not run it.
# Must be sourced from inside the private D-Bus session started by the outer scripts.

DEST=org.gnome.Shell.Extensions
OBJ=/org/gnome/Shell/Extensions
STATE_ENABLED=1.0
STATE_DISABLED=2.0
# Log lines that mean the extension misbehaved. The temporary directories of the
# tests contain "luciole", so match the extension's own markers, not the word.
EXTENSION_ERROR_PATTERN='JS ERROR|CRITICAL.*\[Luciole\]|WARNING.*\[Luciole\]|\[Luciole\] .*(failed|error)|luciole@luciole\.dev.*(CRITICAL|rror|arning)|already disposed'

# start_shell <logfile>: starts a headless shell and stops it when the script exits.
start_shell() {
    LOG=$1
    gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x720 >"$LOG" 2>&1 &
    SHELL_PID=$!
    trap 'kill "$SHELL_PID" 2>/dev/null; wait "$SHELL_PID" 2>/dev/null' EXIT
}

ext_call() {
    method=$1
    shift
    gdbus call --session --dest "$DEST" --object-path "$OBJ" --method "$DEST.$method" "$@" 2>&1
}

ext_state() {
    ext_call GetExtensionInfo "$UUID" | sed -n "s/.*'state': <\([0-9.]*\)>.*/\1/p"
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
