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
| Reads | The installed applications (through GIO), the file index of the desktop search service (read-only queries), its own settings (GSettings) and its own history files. |
| Writes | Its settings, and two history files in the user's data directory (`luciole/frecency.json` and `luciole/queries.json`), created readable by the user only. |
| Runs | Applications the user chooses, through GIO, and the actions such an application declares itself in its desktop file. Files and folders the user chooses, through the default handler for their address. "Open With" hands the file to GNOME's own application chooser (the desktop portal, `org.freedesktop.portal.OpenURI`, asked to let the user choose): the user picks the application there, and Luciole never lists or starts it itself. A terminal of GNOME (Ptyxis, Console or GNOME Terminal) when the user chooses to open one in a folder. Nothing else is ever executed. |
| Clipboard | Written to only when the user asks: Enter on a calculation (the answer), "Copy Path" or "Copy Name" (the path or name of a local file), Ctrl+C or "Copy File" / "Copy Folder" (the address of a local file or folder, in the form Files pastes). Never read. |
| Other processes | None started by the extension on its own. GNOME's file previewer is started by the session bus when the user asks for a preview; a terminal when the user asks for one. |

The history file records which applications and files were opened, with
dates. It is capped in size (a few hundred entries, ten dates each), a file over
1 MB is not read at all, it can be cleared from the preferences, and it is never read by
anything but Luciole.

The searches file (`queries.json`) records the text of the last 20 searches that led to a result
being opened, so the up arrow can bring one back. A search that led nowhere is never written. It
is on by default, can be switched off in the preferences (which erases it at once) or cleared
there, is capped at 1 MB like the other file, and what is read from it goes through the same
cleaning as a result name (no control or bidirectional characters, at most 256 characters, no
duplicates).

## Where untrusted data comes from

1. **What the user types.** Not trusted: it can contain anything, including
   characters that mean something to a query language, or that look like a
   calculation.
2. **The file index.** File names and paths are chosen by whoever created the
   files (a downloaded archive, another user of the machine).
3. **The history files.** Another program running as the same user could edit it,
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
* **Names are displayed as text, never as markup, and cleaned first.** The highlighted part of
  a result is built from separate labels, not from an escaped markup string. Every text a
  provider returns goes through one cleaning step before it is matched or shown: control
  characters and line breaks are removed, and so are the bidirectional override and isolate
  characters that can make a file name read as a harmless one; a very long name is cut. A result
  left with no title is dropped.
* **A broken history is ignored** (both files). Unreadable, corrupt or hostile content (wrong
  types, non-finite numbers, too many entries) gives an empty history, with a
  warning in the log, and never an exception.
* **Only existing local files are opened.** An address must be `file:///` and a path (no host, no
  other scheme, no query), and the file or folder must still exist, or nothing is launched and the
  failure is logged. The search field takes at most 256 characters.
* **The menu of actions is checked like any other data.** What a source offers as actions is
  cleaned (texts like result names, at most 24 actions, no duplicate id, copied text capped) before
  it is shown. An action is only ever run by the source that offered it, which refuses any
  identifier it did not offer: an application action must be one the application declares, and
  for "Open With" the file must still exist and be local; it is passed to the desktop portal as an
  open handle on that file, never as a text the portal would have to trust. Nothing typed by the user is part of an action.
* **The calculator reads text, it never runs it.** A calculation or conversion typed in the field
  is read by a small parser of our own (`src/core/calc.js`), not by `eval` or `Function`. It
  accepts digits, a few operators, brackets, a short list of named functions and unit names, and
  nothing else: any other character, an unknown word or an incomplete expression gives no result
  at all. Its work is bounded: a text of at most 200 characters and 100 pieces, brackets and signs
  nested at most 16 deep, and no loop of any kind, so no input can make it run long. A result that
  is not a finite number (division by zero, overflow) is dropped. It uses no network: there are
  no currencies.
* **The System source asks, it does not do.** It lists the actions the shell itself offers (lock,
  power off, restart, log out, suspend, switch user, screenshot) and the Settings panels, and
  nothing else: only the shell's own eight identifiers are ever passed back to it, and the shell
  re-checks that an action is available and confirms the drastic ones with its own dialog. Actions
  that end the session are never the top hit and are never selected for the user: Enter does
  nothing until an arrow key has chosen them. They run only once the launcher is gone, whether
  chosen with Enter or with Open in the menu of actions, so the shell's own dialog never has to
  share the keyboard with it. A panel is opened only if it is one of the installed
  desktop files named `gnome-*-panel.desktop`. Luciole reads no setting.
* **Show in Folder hands over only a local file that still exists**, to the desktop's standard
  file manager interface (`org.freedesktop.FileManager1`, which shows it selected); when none
  answers, the file's folder is opened instead, under the same checks.
* **A terminal is started from a list of arguments, never a command line.** "Open a Terminal Here"
  is offered only when Ptyxis, Console or GNOME Terminal is found, by its absolute path, in the
  shell's search path. The folder (the folder chosen, or the one holding the file chosen) must be
  local and still exist; it is passed as one argument (`--working-directory=<folder>`) through
  GNOME Shell's own launcher, so no shell ever reads its name, whatever characters it holds.
* **A file is copied as an address.** Ctrl+C (and "Copy File" / "Copy Folder") puts the address of
  a local file or folder that still exists on the clipboard, in the form Files pastes
  (`x-special/gnome-copied-files`); nothing of its content is read. With text selected in the
  search field, Ctrl+C copies that text instead, as any text field does.
* **Folders come from the same index, by the same rules.** They are found by a second read-only
  query, with the user's words bound as a value like any search, and the same exclusions (hidden
  folders, excluded folders) as files.
* **The preview shows only a local file that still exists**, through GNOME's own previewer (the
  one the Files application uses), asked over the session bus with the file's address and nothing
  else. While it is shown, Luciole lets go of the keyboard and gives it to the preview window; it
  comes back when the previewer says the preview was closed, or after five seconds if no preview
  window ever appeared. A preview already on screen is recognised as such (its state is read, not
  only waited for), so the launcher never comes back over it. Without the previewer installed, no preview is offered.
* **A type of file is picked from a fixed list.** In "/pdf facture" only the words reach the
  index, as the bound full-text terms they always were; the type is one of eight known ones, and is
  applied by comparing each file's MIME type (or, when the index does not know it, its extension)
  with that list. A test checks that every extension listed for a type is accepted through the
  MIME type the system gives it as well. Anything else after "/" is searched as plain text.
* **No dynamic code.** No `eval`, no `Function`, no shell command built from
  text. Applications and files are opened with GIO using the entry or address
  that came from the index, not from the typed text.
* **Failures stay contained.** Every provider runs behind an error barrier and a
  timeout, with its own cancellation. A provider that fails or hangs produces a
  log line and no results; it cannot block the launcher or the shell. Cursors
  of the index connection are always closed before the connection is, and
  shutting the provider down waits for the searches still running (closing a
  connection under an open cursor aborts the whole process).
* **Clean-up is ordered and complete.** Everything the extension creates (signals,
  timers, keybinding, actors, the keyboard grab) is registered and released when
  it is disabled, including while the launcher is open. Nothing is created when
  the module is loaded.
* **The launcher cannot trap the keyboard.** It closes when the screen locks,
  when the session mode changes, when the keyboard focus goes elsewhere, and on
  Super or Alt+Tab. The shortcut that opened it closes it again.

## How this is checked

Every change must pass `make gate` (see `tests/gate.sh`):

* linting, including rules that keep the pure core free of shell and UI imports, and a test that
  no source file holds an invisible bidirectional or zero-width character ("Trojan Source");
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

The gate runs the same checks at three depths, which differ only in how many mutants run and
how the shell tests are scheduled:

* `make gate`, while working: the mutants of the changed lines (and a few lines around them),
  the mutants new in their specification, and a random tenth of the others, drawn again each
  run (the seed is printed so a run can be replayed); the shell tests three at a time;
* `make gate-push`, before a push: every mutant of every file changed since the last push, the
  shell tests one after the other so their timings are measured alone;
* `make gate-full`, at the end of a set of features: every mutant, longer loops.

Mutants run in temporary copies of the project, several at a time, so the working copy is never
modified, even by an interrupted run. Before judging any mutant, each test runs once without
one: a test that fails on its own would otherwise count every mutant as noticed. A mutant of a
shell test runs only the part of the test that covers it (`FILES_PARTS`); the whole test runs in
the gate. A mutant already noticed is not run again while nothing changed: not a file of the
sources or the tests, not the mutant or its test, not the versions of GNOME Shell and GJS (any
change to any of them runs it again). A survivor is never kept, and `make gate-full` ignores this
cache.

## Not covered yet

* No test with a screen reader yet.
* Who owns a file, and whether the user may read it, is not checked: opening is left to the
  system, as in any file manager.

## Reporting a problem

Open an issue on the project's repository for a bug. For a vulnerability, please use the
repository's private vulnerability reporting (Security tab, "Report a vulnerability") instead of a
public issue.
