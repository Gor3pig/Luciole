<!--
SPDX-FileCopyrightText: 2026 Luciole contributors
SPDX-License-Identifier: GPL-2.0-or-later
-->

# Security and reliability

Luciole runs **inside GNOME Shell**, with the full privileges of the desktop
session, and it reads text typed by the user and names written by other
programs. A mistake here can freeze or crash the whole desktop, so this page
states what the extension touches, where untrusted data comes from, and how each
source is handled. It also lists what is *not* covered yet.

## What Luciole does

| Area | Behaviour |
|---|---|
| Network | None. Nothing is sent anywhere: no telemetry, no web search, no update check. |
| Reads | The installed applications (through GIO), the file index of the desktop search service (read-only queries), its own settings (GSettings) and its own history file. |
| Writes | Its settings, and one history file in the user's data directory (`luciole/frecency.json`), created readable by the user only. |
| Runs | Applications the user chooses, through GIO. Files and folders the user chooses, through the default handler for their address. Nothing else is ever executed. |
| Other processes | None started by the extension itself. |

The history file records which applications and files were opened, with
dates. It is capped in size (a few hundred entries, ten dates each), can be
cleared from the preferences, and is never read by anything but Luciole.

## Where untrusted data comes from

1. **What the user types.** Not trusted: it can contain anything, including
   characters that mean something to a query language.
2. **The file index.** File names and paths are chosen by whoever created the
   files (a downloaded archive, another user of the machine).
3. **The history file.** Another program running as the same user could edit it,
   and it can be corrupted by a crash or a full disk.
4. **Application entries** (`.desktop` files). Names and keywords are written by
   package authors and may be odd or malformed.

## How each source is handled

* **The typed text never becomes query text.** For the file search it is reduced
  to plain words made of letters and digits, each ending with a star, and passed
  to the index as a *bound parameter* of a prepared statement. The SPARQL text is
  a constant. Operators, quotes and parentheses are dropped before the query
  exists. Random-data tests check this property on thousands of hostile inputs.
* **Results are bounded.** The number of rows asked from the index, the number of
  results kept, the number of words in a query and the size of the history are all
  capped.
* **Hidden files and excluded folders and types are never shown**, whatever the
  index returns.
* **Names are displayed as text, never as markup.** The highlighted part of a
  result is built from separate labels, not from an escaped markup string.
* **A broken history is ignored.** Unreadable, corrupt or hostile content (wrong
  types, non-finite numbers, too many entries) gives an empty history, with a
  warning in the log, and never an exception.
* **No dynamic code.** No `eval`, no `Function`, no shell command built from
  text. Applications and files are opened with GIO using the entry or address
  that came from the index, not from the typed text.
* **Failures stay contained.** Every provider runs behind an error barrier and a
  timeout, with its own cancellation. A provider that fails or hangs produces a
  log line and no results; it cannot block the launcher or the shell. Cursors
  of the index connection are always closed before the connection is.
* **Clean-up is ordered and complete.** Everything the extension creates (signals,
  timers, keybinding, actors, the keyboard grab) is registered and released when
  it is disabled, including while the launcher is open. Nothing is created when
  the module is loaded.
* **The launcher cannot trap the keyboard.** It closes when the screen locks,
  when the session mode changes, when the keyboard focus goes elsewhere, and on
  Super or Alt+Tab. The shortcut that opened it closes it again.

## How this is checked

Every change must pass `make gate` (see `tests/gate.sh`):

* linting, including rules that keep the pure core free of shell and UI imports;
* unit tests, and **random-data tests** with fixed, replayable seeds;
* **mutation checks**: the code is broken on purpose, one small change at a time,
  and the tests must fail each time. A mutant that survives is a hole in the tests;
* tests inside a real GNOME Shell started headless, with a private session bus,
  private settings and a private data directory, so they cannot touch the
  developer's own session: enabling and disabling in a loop, opening and closing
  with the shortcut, search, files, the missing-index case, screen lock;
* an **endurance test**: thousands of random actions, then checks that the shell
  is alive, the log is clean, every opening was closed, the keyboard is free and
  memory did not run away;
* a check of the built package: expected files present, nothing extra, no
  private detail of the build machine, schema compiles strictly.

## Not covered yet

* Names are shown as they are. Control characters and the bidirectional
  override characters that can disguise a file name are not yet neutralised.
* Opening a file does not check first that it still exists.
* The history file is read without a size limit before its content is trimmed.
* No test with a screen reader yet.
* Memory is checked by resident size in the shell process, which is noisy; slow
  leaks are only caught by the differential tests.

## Reporting a problem

Open an issue on the project's repository. For a vulnerability, please do not
include working exploit details in a public issue; say that you have a security
report and a maintainer will arrange a private channel.
