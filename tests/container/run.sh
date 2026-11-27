#!/bin/sh
# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later

# Runs the tests of Luciole on GNOME Shell 50, in a podman container: nothing is installed on the
# host. The image is kept between runs; remove it with "podman rmi localhost/luciole-gnome50-test".
#
#   sh tests/container/run.sh            unit, random-data and the headless shell tests
#   sh tests/container/run.sh --capture  also two screenshots (light, dark) in dist/container/
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
IMAGE=localhost/luciole-gnome50-test
NAME=luciole-gnome50-$$

podman build --quiet -t "$IMAGE" -f "$ROOT/tests/container/Containerfile" "$ROOT/tests/container" >/dev/null

# systemd as the first process (gnome-shell needs logind); /dev/dri for the shell's rendering.
podman run -d --name "$NAME" --systemd=always --security-opt label=disable --device /dev/dri "$IMAGE" >/dev/null
trap 'podman rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

# A copy of the sources and tests, owned by the test user.
tar -C "$ROOT" -cf - src tests Makefile | podman exec -i "$NAME" sh -c 'mkdir -p /work && tar -C /work -xf - && chown -R tester /work'

i=0
until podman exec "$NAME" systemctl is-system-running --wait >/dev/null 2>&1 || [ "$i" -ge 30 ]; do
    i=$((i + 1))
    sleep 1
done

status=0
podman exec -i --user tester -w /work "$NAME" sh -s -- "${1:-}" <<'INSIDE' || status=$?
set -u
export HOME=/home/tester XDG_RUNTIME_DIR=/tmp/runtime-tester
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
echo "GNOME Shell: $(gnome-shell --version); GJS: $(gjs --version)"
failed=0
run() {
    echo "######## $*"
    if "$@" >/tmp/out.log 2>&1; then
        tail -n 3 /tmp/out.log
        echo "PASS  $*"
    else
        tail -n 25 /tmp/out.log
        echo "FAIL  $*"
        failed=$((failed + 1))
    fi
}
run gjs -m tests/run.js
run sh -c 'for seed in 1 2 3; do LUCIOLE_SEED=$seed gjs -m tests/run.js --fuzz || exit 1; done'
for test in "cycle.sh 200" "openclose.sh 80" placement.sh race.sh history.sh search.sh files.sh degrade.sh; do
    # shellcheck disable=SC2086
    run sh tests/shell/$test
done
if [ "$1" = --capture ]; then
    # PipeWire for the screen cast the screenshots go through.
    dbus-run-session -- sh -c 'pipewire & wireplumber & sleep 2;
        CAPTURE_INDEX=1 sh tests/shell/capture.sh /tmp/light.png light open "/" &&
        CAPTURE_INDEX=1 sh tests/shell/capture.sh /tmp/dark.png dark open "quok"' >/tmp/capture.log 2>&1 \
        && echo "PASS  captures" || { tail -n 15 /tmp/capture.log; echo "FAIL  captures"; failed=$((failed + 1)); }
fi
echo
[ "$failed" -eq 0 ] && echo "CONTAINER: PASS" || echo "CONTAINER: FAIL ($failed)"
[ "$failed" -eq 0 ]
INSIDE
if [ "${1:-}" = --capture ]; then
    mkdir -p "$ROOT/dist/container"
    podman cp "$NAME:/tmp/light.png" "$ROOT/dist/container/" 2>/dev/null || true
    podman cp "$NAME:/tmp/dark.png" "$ROOT/dist/container/" 2>/dev/null || true
fi
exit "$status"
