#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later

# The quality gate: nothing is committed unless every step is green.
#
#   sh tests/gate.sh              the usual run (a few minutes)
#   GATE_FULL=1 sh tests/gate.sh  full cycle counts and the whole mutation set
#   GATE_SOAK=1 sh tests/gate.sh  also the long endurance test
#   GATE_KEEP_GOING=1 ...         do not stop at the first failure
#
# The steps, in order: ESLint, unit tests, random-data tests (three fixed
# seeds), mutation checks of the changed files, the package check, then the
# tests inside an isolated GNOME Shell.
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

mutation() {
    if [ -n "${GATE_FULL:-}" ]; then
        gjs -m tests/mutation/run.js
    else
        gjs -m tests/mutation/run.js --changed --with-slow
    fi
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
step "shell: enable/disable cycles" sh tests/shell/cycle.sh "$CYCLES"
step "shell: open/close, keys, lock" sh tests/shell/openclose.sh "$UI_CYCLES"
step "shell: placement, two monitors" sh tests/shell/placement.sh
step "shell: search" sh tests/shell/search.sh
step "shell: files" sh tests/shell/files.sh
step "shell: no file index" sh tests/shell/degrade.sh
if [ -n "${GATE_SOAK:-}" ]; then
    step "shell: endurance" sh tests/shell/soak.sh 6000 1
fi
finish
