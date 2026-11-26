#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later

# The quality gate: nothing is committed unless every step is green.
#
#   sh tests/gate.sh              quick, while iterating: the mutants of the changed lines (and
#                                 the new ones, and a random tenth of the others), shell tests
#                                 three at a time
#   GATE_PUSH=1 sh tests/gate.sh  before a push: every mutant of every file changed since the
#                                 last push, shell tests one after the other (their timings hold)
#   GATE_FULL=1 sh tests/gate.sh  end of a lot: the whole mutation set, cache ignored, longer
#                                 cycle counts
#   GATE_SOAK=1 sh tests/gate.sh  also the long endurance test
#   GATE_KEEP_GOING=1 ...         do not stop at the first failure
#
# The steps, in order: ESLint, unit tests, random-data tests (three fixed
# seeds), mutation checks, the translations and package checks, then the
# tests inside an isolated GNOME Shell. Every run checks the same things;
# only how many mutants and how the shell tests are scheduled change.
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 1

STEPS=0
FAILED=0
SUMMARY=""

step() { # step <name> <command...>
    name=$1
    shift
    STEPS=$((STEPS + 1))
    echo
    echo "################ $name"
    start=$(date +%s)
    if "$@"; then
        status=PASS
    else
        status=FAIL
        FAILED=$((FAILED + 1))
    fi
    elapsed=$(($(date +%s) - start))
    SUMMARY="$SUMMARY
$(printf '%-34s %-5s %4ss' "$name" "$status" "$elapsed")"
    if [ "$status" = FAIL ] && [ -z "${GATE_KEEP_GOING:-}" ]; then
        finish
    fi
}

finish() {
    echo
    echo "################ SUMMARY"
    echo "$SUMMARY"
    echo
    if [ "$FAILED" -eq 0 ]; then
        echo "GATE: PASS ($STEPS steps)"
        exit 0
    fi
    echo "GATE: FAIL ($FAILED of $STEPS steps failed)"
    exit 1
}

fuzz() {
    for seed in 1 2 3; do
        echo "seed $seed"
        LUCIOLE_SEED=$seed gjs -m tests/run.js --fuzz | tail -n 2 || return 1
    done
}

# What "changed" means before a push: everything since the branch was last pushed.
pushed_base() {
    git rev-parse --verify --quiet '@{upstream}' >/dev/null && echo '@{upstream}' || echo HEAD
}

mutation() {
    if [ -n "${GATE_FULL:-}" ]; then
        gjs -m tests/mutation/run.js --no-cache
    elif [ -n "${GATE_PUSH:-}" ]; then
        gjs -m tests/mutation/run.js --changed --with-slow --base "$(pushed_base)"
    else
        gjs -m tests/mutation/run.js --changed --with-slow --lines
    fi
}

# The shell tests, each in its own private shell: one after the other before a push or at the end
# of a lot, three at a time otherwise. Same tests, same checks; logs in a temporary folder.
shell_tests_together() {
    logs=$(mktemp -d)
    cat >"$logs/list" <<LIST
cycles|sh tests/shell/cycle.sh $CYCLES
open-close|sh tests/shell/openclose.sh $UI_CYCLES
placement|sh tests/shell/placement.sh
races|sh tests/shell/race.sh
history|sh tests/shell/history.sh
search|sh tests/shell/search.sh
files|sh tests/shell/files.sh
no-index|sh tests/shell/degrade.sh
LIST
    # xargs runs three at a time and reports a failure of any of them.
    status=0
    tr '\n' '\0' <"$logs/list" | xargs -0 -P 3 -I {} sh -c '
        name=${1%%|*}; command=${1#*|}
        if $command >"$2/$name.log" 2>&1; then echo "PASS  $name"; else echo "FAIL  $name"; : >"$2/$name.failed"; exit 1; fi
    ' _ {} "$logs" || status=1
    if [ "$status" -ne 0 ]; then
        for failed in "$logs"/*.failed; do
            test_name=${failed##*/}
            test_name=${test_name%.failed}
            echo "---- $test_name"
            tail -n 15 "$logs/$test_name.log"
        done
    fi
    rm -rf "$logs"
    return "$status"
}

CYCLES=60
UI_CYCLES=80
if [ -n "${GATE_FULL:-}" ]; then
    CYCLES=100
    UI_CYCLES=150
fi

step "eslint" npx eslint .
step "unit tests" gjs -m tests/run.js
step "random-data tests" fuzz
step "mutation checks" mutation
step "translations" sh tests/po-check.sh
step "package check" sh tests/zipcheck.sh
if [ -n "${GATE_PUSH:-}${GATE_FULL:-}" ]; then
    step "shell: enable/disable cycles" sh tests/shell/cycle.sh "$CYCLES"
    step "shell: open/close, keys, lock" sh tests/shell/openclose.sh "$UI_CYCLES"
    step "shell: placement, two monitors" sh tests/shell/placement.sh
    step "shell: races, rapid toggles" sh tests/shell/race.sh
    step "shell: remembered searches" sh tests/shell/history.sh
    step "shell: search" sh tests/shell/search.sh
    step "shell: files" sh tests/shell/files.sh
    step "shell: no file index" sh tests/shell/degrade.sh
else
    step "shell: the 8 tests, 3 at a time" shell_tests_together
fi
if [ -n "${GATE_SOAK:-}" ]; then
    step "shell: endurance" sh tests/shell/soak.sh 6000 1
fi
finish
