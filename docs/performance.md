# Performance

Luciole must feel instantaneous and must never block GNOME Shell.

## Rules

- No synchronous input/output on the main loop: files and the history are read
  and written asynchronously; the file index connection is opened asynchronously
  and only when the first file search needs it.
- Every search is cancelled when the next key is typed.
- Every source has a time limit; a source that exceeds it is ignored.
- The application index lives in memory, with texts folded once, and is rebuilt
  only when the shell reports that applications were installed or removed.
- Result updates are coalesced to one per frame; the number of results is capped
  and the list scrolls beyond half of the monitor's height.

## Budgets and what was measured

All numbers below were measured **in a virtual machine**, so they show orders of
magnitude, not what a physical machine will do. They are not a promise.

| What | Budget | Measured |
|---|---|---|
| Shortcut to window shown (the handler's own work, not the compositor frame) | 50 ms | 4 to 8 ms |
| Keystroke to the first results (applications) | 16 ms of work | median 7 to 10 ms, worst 18 to 38 ms across runs |
| Keystroke to complete results with files, 50 ms debounce included | target 150 ms, ceiling 400 ms | 68 ms worst, against a small stand-in index |
| One file query against a real index of about 2 400 entries | | 63 to 153 ms |
| Memory over 150 open/close cycles | no growth once warm | flat after about 110 cycles |

Honest reading of the file numbers: with the real index the whole path is
expected to take roughly 110 to 200 ms (50 ms debounce plus the query), which
is within the ceiling and around the target. That figure is an estimate to be
confirmed on a real desktop.

Memory: GNOME Shell itself grows by a few hundred kB per enable/disable cycle
even with an empty extension, and its resident memory is noisy. The tests
therefore compare Luciole with an empty control extension, over the second half
of the run. The enable/disable test only detects leaks of about 1 MB per cycle
or more; the open/close test is much more sensitive, because its curve is flat.

## How to measure

Enable `debug-timings` (preferences, Advanced) or:

```sh
gsettings set org.gnome.shell.extensions.luciole debug-timings true
journalctl --user -f -o cat | grep Luciole
```

Messages such as `perf open: 5.02 ms`, `perf query to results: 7.7 ms` and
`perf query to final results: 68 ms` are then written. Nothing is logged when
the setting is off.

The automated checks are `make shell-test` (enable/disable cycles),
`make shell-test-ui` (open/close cycles and opening time),
`make shell-test-search` and `make shell-test-files` (time from keystroke to
results). `gnome-shell --profile=<file>` gives a trace for anything suspicious.
