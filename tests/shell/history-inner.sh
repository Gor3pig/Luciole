#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later
# Runs inside the private D-Bus session started by history.sh. Do not call directly.
set -u

WORK=$1
LOG_FILE=$2
UUID=$3
MODE=$4
. "$(dirname "$0")/lib.sh"

SCHEMA=org.gnome.shell.extensions.luciole
QUERIES_FILE="$WORK/data/luciole/queries.json"

start_shell "$LOG_FILE"
wait_for_extension
apps_only
ext_call EnableExtension "$UUID" >/dev/null
wait_ext_state "$STATE_ENABLED" || fail "extension not ENABLED (state=$(ext_state))"
gsettings set "$SCHEMA" debug-timings true || fail "could not set debug-timings"
start_keys

count() { grep -c "\[Luciole\] $1" "$LOG" || true; }
wait_count() {
    i=0
    while [ "$i" -lt 100 ]; do
        [ "$(count "$1")" -ge "$2" ] && return 0
        sleep 0.05
        i=$((i + 1))
    done
    return 1
}
open_launcher() {
    OPENED=$(count opened)
    combo
    wait_count 'opened' $((OPENED + 1)) || fail "the launcher did not open"
    sleep 0.4
}
close_launcher() {
    CLOSED=$(count closed)
    escape
    sleep 0.1
    [ "$(count closed)" -gt "$CLOSED" ] || escape
    wait_count 'closed' $((CLOSED + 1)) || fail "the launcher did not close"
    sleep 0.3
}
# field_text: what the search field holds.
field_text() {
    shell_eval "(function find(a) { if ((a.style_class || '').includes('luciole-entry') && a.get_text) return a.get_text() || '-'; for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage) || '-'"
}
# hint_state: "shown <text>" or "hidden" for the note that says which remembered search is on screen.
hint_state() {
    shell_eval "(function find(a) { if ((a.style_class || '').includes('luciole-history-hint')) return a.visible ? 'shown ' + a.get_text() : 'hidden'; for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage)"
}
# expect <what> <field text> <hint>: the field and the hint are what they should be.
expect() {
    sleep 0.25
    [ "$(field_text)" = "$2" ] || fail "$1: the field holds '$(field_text)', expected '$2'"
    case "$3" in
        hidden) [ "$(hint_state)" = hidden ] || fail "$1: the hint is '$(hint_state)', expected hidden" ;;
        # "3" is "<position> <total>"; the wording follows the language of the session, the numbers do not.
        *) set -- "$1" "$2" ${3%% *} ${3##* }
           case "$(hint_state)" in
               "shown "*" $3 "*" $4") ;;
               *) fail "$1: the hint is '$(hint_state)', expected one that says $3 of $4" ;;
           esac ;;
    esac
}
# type_label: the type of file shown in the field ("PDF"), or "hidden".
type_label() {
    shell_eval "(function find(a) { if ((a.style_class || '').includes('luciole-type-chip')) return a.visible ? a.get_text() : 'hidden'; for (const c of a.get_children()) { const r = find(c); if (r) return r; } return ''; })(global.stage) || 'hidden'"
}
# last_query: the query of the latest results.
last_query() { grep -F '[Luciole] results:' "$LOG" | tail -n 1 | sed 's/.* query=//'; }
queries_in_file() {
    sleep 0.3
    sed -n 's/.*"queries":\[\([^]]*\)\].*/\1/p' "$QUERIES_FILE" 2>/dev/null
}

case "$MODE" in
recent)
    open_launcher
    sleep 0.4
    last_selected() { grep -F '[Luciole] selected: ' "$LOG" | tail -n 1 | sed 's/.*selected: //'; }
    grep -F '[Luciole] results:' "$LOG" | tail -n 1 | grep -qE 'results: 3 first=Zquok Ant query=$' ||
        fail "recent: the empty field should list the three recent applications ($(grep -F '[Luciole] results:' "$LOG" | tail -n 1))"
    press Down
    press Down
    sleep 0.3
    [ "$(last_selected)" = apps:luciole-test-zquok-Cat.desktop ] || fail "recent: two down arrows should reach the third ('$(last_selected)')"
    press Up
    sleep 0.3
    [ "$(last_selected)" = apps:luciole-test-zquok-Bee.desktop ] || fail "recent: the up arrow should go back up the list ('$(last_selected)')"
    [ "$(field_text)" = - ] || fail "recent: the up arrow brought a search back ('$(field_text)') instead of moving up the list"
    press Up
    sleep 0.3
    [ "$(last_selected)" = apps:luciole-test-zquok-Ant.desktop ] && [ "$(field_text)" = - ] || fail "recent: the second up arrow should reach the first ('$(last_selected)', '$(field_text)')"
    press Up
    expect "up at the top of the list" firefox "1 3"
    echo "history: in the list of recent items the up arrow goes up first, then brings searches back"
    close_launcher
    ;;
types)
    # A search with a type comes back as the label and the words; the next one comes back without it.
    open_launcher
    press Up
    sleep 0.4
    [ "$(type_label)" = PDF ] || fail "types: the remembered '/pdf facture' did not bring the PDF label back ('$(type_label)')"
    [ "$(field_text)" = facture ] || fail "types: the field holds '$(field_text)', expected 'facture'"
    press Up
    sleep 0.4
    [ "$(type_label)" = hidden ] || fail "types: the PDF label stayed on the next remembered search"
    [ "$(field_text)" = notes ] || fail "types: the field holds '$(field_text)', expected 'notes'"
    [ "$(last_query)" = notes ] || fail "types: the search sent was '$(last_query)', expected 'notes' (no type)"
    press Down
    sleep 0.4
    [ "$(type_label)" = PDF ] && [ "$(field_text)" = facture ] || fail "types: going forward did not bring '/pdf facture' back ($(type_label) '$(field_text)')"
    press Down
    sleep 0.4
    [ "$(type_label)" = hidden ] && [ "$(field_text)" = - ] || fail "types: back to the empty field, the label stayed ($(type_label) '$(field_text)')"
    echo "history: a remembered search keeps its own type, and only its own"
    close_launcher
    ;;
arrows)
    open_launcher
    expect "empty field on opening" '-' hidden
    press Up
    expect "up arrow" firefox "1 3"
    press Up
    expect "up again" calculatrice "2 3"
    press Up
    expect "up again" notes "3 3"
    press Up
    expect "up at the oldest" notes "3 3"
    echo "history: the up arrow goes back through the searches and stops at the oldest"
    press Down
    expect "down arrow" calculatrice "2 3"
    press Down
    expect "down again" firefox "1 3"
    press Down
    expect "down past the newest" '-' hidden
    press Down
    expect "down in the empty field" '-' hidden
    echo "history: the down arrow comes forward and back to the empty field"

    press Up
    expect "up before typing" firefox "1 3"
    typed x
    expect "typing replaces the recalled search" x hidden
    press Up
    expect "up with text typed moves in the results, not the history" x hidden
    echo "history: typing leaves the remembered searches"

    escape
    expect "Escape clears the field" '-' hidden
    press Up
    expect "up again" firefox "1 3"
    escape
    expect "Escape in the history clears the field" '-' hidden
    # What is typed next arrives whole (the selection of the recalled search must not swallow it).
    typed ab
    expect "typing after Escape in the history" ab hidden
    escape
    expect "Escape clears what was typed" '-' hidden
    close_launcher
    open_launcher
    press Up
    press Up
    close_launcher
    open_launcher
    expect "reopened after going back" '-' hidden
    press Up
    expect "up after reopening starts from the newest" firefox "1 3"
    close_launcher
    echo "history: Escape and reopening leave the remembered searches"
    ;;
clear)
    open_launcher
    press Up
    expect "history present" firefox "1 3"
    close_launcher
    gsettings set "$SCHEMA" history-generation 1 || fail "could not ask for the history to be erased"
    sleep 1
    [ -z "$(queries_in_file)" ] || fail "Clear History left searches in the file: $(queries_in_file)"
    open_launcher
    press Up
    expect "up after Clear History" '-' hidden
    close_launcher
    echo "history: Clear History forgets the remembered searches"
    ;;
off)
    gsettings set "$SCHEMA" remember-queries false || fail "could not turn the setting off"
    sleep 1
    [ -z "$(queries_in_file)" ] || fail "turning the setting off left searches in the file: $(queries_in_file)"
    open_launcher
    press Up
    expect "up with remembering off" '-' hidden
    close_launcher
    gsettings set "$SCHEMA" remember-queries true || fail "could not turn the setting on"
    open_launcher
    press Up
    expect "up after turning it on again (they were erased)" '-' hidden
    close_launcher
    echo "history: turning the setting off erases the remembered searches"
    ;;
esac

kill -0 "$SHELL_PID" 2>/dev/null || fail "the shell died"
[ -z "$(log_errors 'JS ERROR|CRITICAL|\[Luciole\] .*error')" ] || fail "errors in the log: $(log_errors 'JS ERROR|CRITICAL|\[Luciole\] .*error' | head -n 6)"
echo "PASS"
