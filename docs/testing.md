# Testing

Luciole is checked at several levels, from plain functions to a real GNOME Shell. Everything runs
on the developer's machine; nothing is sent anywhere.

| Command | What it runs | Time |
|---|---|---|
| `make check` | ESLint and the unit tests (plain `gjs`, no shell) | ~10 s |
| `make gate` | the quality gate while working: unit, random-data, mutation checks of the changed lines, translations, package, then the eight shell tests three at a time | ~7 min |
| `make gate-push` | before a push: every mutant of every file changed since the last push, shell tests one after the other | ~15 min |
| `make gate-full` | at the end of a set of features: every mutant (no cache), longer loops | ~45 min |
| `make test-gnome50` | the unit and shell tests on GNOME Shell 50, in a container | ~5 min |

## Tests in a real shell

`tests/shell/*.sh` start GNOME Shell headless, on a private D-Bus session, with private settings,
data and runtime folders, so the tests never touch the session they are started from. They drive
the launcher with real key presses and pointer clicks (through the shell's remote desktop
interface) and read its state through the shell's evaluation interface, which is only enabled in
these private shells. They bring their own applications and files: the results do not depend on
what the machine has installed, and the labels are read in French on any machine.

`sh tests/shell/capture.sh <file.png> [light|dark] [open] [query]` takes a screenshot of the
launcher in such a shell, with made-up files (`CAPTURE_INDEX=1`); `CAPTURE_CROP=1` keeps only the
window and a margin around it.

## Mutation checks

`tests/mutation/*.json` list small, deliberate breakages of the code. Each one must make a test
fail; one that does not ("survived") is a hole in the tests. They run in temporary copies of the
project, several at a time, and only after each test has passed once without any breakage. See
`tests/mutation/run.js` for the options.

## GNOME Shell 50

The development machine runs GNOME Shell 51. `make test-gnome50` (`tests/container/run.sh`)
builds a Fedora 44 image with GNOME Shell 50 (`tests/container/Containerfile`), runs the unit,
random-data and shell tests in it, and saves two screenshots in `dist/container/`. It needs
`podman`; the image is kept between runs (`podman rmi localhost/luciole-gnome50-test` removes it).
