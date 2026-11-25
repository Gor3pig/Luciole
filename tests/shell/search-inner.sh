#!/bin/sh
# Runs inside the private D-Bus session started by search.sh. Do not call directly.
set -u

WORK=$1
LOG_FILE=$2
UUID=luciole@luciole.dev
. "$(dirname "$0")/lib.sh"
SCHEMA=org.gnome.shell.extensions.luciole
# Budget for the time from a keystroke to the results being shown (ms), in this VM.
QUERY_BUDGET_MS=50

start_shell "$LOG_FILE"
wait_for_extension
gsettings set "$SCHEMA" debug-timings true || fail "could not set debug-timings"
apps_only
ext_call EnableExtension "$UUID" >/dev/null
wait_ext_state "$STATE_ENABLED" || fail "extension not ENABLED (state=$(ext_state))"
start_keys

wait_log() { # wait_log <fixed text> [count] [seconds]: polls until the text appears <count> times
    i=0
    while [ "$i" -lt $((${3:-5} * 20)) ]; do
        [ "$(grep -cF "$1" "$LOG")" -ge "${2:-1}" ] && return 0
        sleep 0.05
        i=$((i + 1))
    done
    return 1
}
clear_entry() { # clear_entry <number of characters>
    n=$1
    while [ "$n" -gt 0 ]; do
        press BackSpace
        n=$((n - 1))
    done
}
expect_first() { # expect_first <query> <title>: types the query and waits for that top result
    typed "$1"
    wait_log "results: " 1
    wait_log "first=$2 query=$1" || fail "query '$1': expected '$2' first; saw: $(grep -F 'query=' "$LOG" | tail -n 2 | tr '\n' '|')"
    echo "ok: '$1' finds '$2'"
    clear_entry "${#1}"
}

wait_log "search ready" || fail "the search never became ready"
combo
wait_log "[Luciole] opened" || fail "the launcher did not open"

# Matching: name, keyword, accents, initials.
expect_first zzmark "Luciole Test Marker"
expect_first luc "Luciole Test Marker"
expect_first fantome "Éditeur Fantôme"
expect_first editeur "Éditeur Fantôme"
expect_first azr "Application Zèbre Rapide"
expect_first zebre "Application Zèbre Rapide"

# Activation with Enter launches the application and records it.
typed zzmark
wait_log "first=Luciole Test Marker query=zzmark" 2 || fail "results for the activation query never came"
press Return
i=0
until [ -e "$WORK/launched" ]; do
    i=$((i + 1))
    [ "$i" -gt 100 ] && fail "Enter did not launch the application"
    sleep 0.05
done
wait_log "[Luciole] closed" || fail "the launcher stayed open after the activation"
echo "ok: Enter launches the application and closes the launcher"

# The history is written a moment later, to a private file.
HISTORY="$WORK/data/luciole/frecency.json"
i=0
until [ -s "$HISTORY" ]; do
    i=$((i + 1))
    [ "$i" -gt 100 ] && fail "the history file was not written"
    sleep 0.1
done
grep -q 'apps:luciole-test-marker.desktop' "$HISTORY" || fail "the history does not mention the application"
[ "$(stat -c %a "$HISTORY")" = 600 ] || fail "the history file is not private (mode $(stat -c %a "$HISTORY"))"
echo "ok: the history is saved, in a private file"

# Recent items appear for an empty query.
combo
wait_log "first=Luciole Test Marker query= " 1 || wait_log "results: 1 first=Luciole Test Marker query=" 1 || fail "the used application is not offered as a recent item"
echo "ok: the used application is offered when the query is empty"
escape
wait_log "[Luciole] closed" 2 || fail "the launcher did not close"

# An application installed while the shell runs is found without restarting.
CHANGES=$(grep -cF 'installed applications changed' "$LOG")
cat >"$WORK/data/applications/luciole-test-late.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Luciole Late Arrival
Exec=true
DESKTOP
wait_log 'installed applications changed' $((CHANGES + 1)) 15 || fail "the shell never reported the new application"
combo
wait_log "[Luciole] opened" 3 || fail "the launcher did not reopen"
expect_first latearr "Luciole Late Arrival"
CHANGES=$(grep -cF 'installed applications changed' "$LOG")
rm -f "$WORK/data/applications/luciole-test-late.desktop"
wait_log 'installed applications changed' $((CHANGES + 1)) 15 || fail "the shell never reported the removal"
typed lateX
wait_log "query=lateX" 1 || fail "no answer after the application was removed"
if grep -F "first=Luciole Late Arrival query=lateX" "$LOG" >/dev/null; then
    fail "a removed application is still offered"
fi
echo "ok: installed and removed applications are noticed"

# Timing.
grep 'perf query to results:' "$LOG" | sed -n 's/.*results: \([0-9.]*\) ms.*/\1/p' >"$LOG.q"
WORST=$(sort -n "$LOG.q" | tail -n 1)
MEDIAN=$(sort -n "$LOG.q" | sed -n "$(( ($(wc -l <"$LOG.q") + 1) / 2 ))p")
echo "keystroke to results (this VM): median ${MEDIAN} ms, worst ${WORST} ms, budget ${QUERY_BUDGET_MS} ms"
awk -v w="$WORST" -v b="$QUERY_BUDGET_MS" 'BEGIN { exit !(w + 0 <= b + 0) }' || fail "results took longer than ${QUERY_BUDGET_MS} ms"

ERRORS=$(grep -ciE "$EXTENSION_ERROR_PATTERN" "$LOG" || true)
echo "log lines mentioning an error about the extension: $ERRORS"
if [ "$ERRORS" -gt 0 ]; then
    grep -iE "$EXTENSION_ERROR_PATTERN" "$LOG" | head -20
    fail "errors found in the shell log"
fi
echo "PASS"
