# Luciole

A Spotlight-style launcher for GNOME Shell: press a shortcut, type, and open
applications and files instantly.

Status: early development, not yet published. Everything below works in the
test environment described in `docs/`; it has not been tried on a wide range of
systems.

## What it does

- **One shortcut** (default `Ctrl+Alt+Space`) opens a floating search field
  centred on the active monitor. `Esc` closes it.
- **Results appear while you type**, with the matching letters highlighted:
  a top hit, then applications, then files. Accents and case do not matter
  (`ecrire` finds "Éditeur de texte" through its keyword "écrire"), initials work
  (`gt` finds "GNOME Terminal") and so does typing letters in order (`ff`
  finds "Firefox").
- **Applications** include Flatpak ones. Those you open often and recently rank
  higher.
- **Files** come from the user's own LocalSearch index (the one GNOME already
  maintains); Luciole indexes nothing itself.
- **Keyboard**: `↑` `↓` move, `Tab` / `Shift+Tab` jump between sections, `Enter`
  opens, `Ctrl+Enter` shows a file in its folder, `Esc` clears then closes.
- Follows the light and dark appearance, the accent colour and the scale factor
  of the session. Available in English and French.

## Requirements

- GNOME Shell 51 on Wayland. Version 50 is declared in `metadata.json` but has
  not been tested yet.
- `localsearch` (the GNOME file indexer) for file results. Without it the
  application results keep working and a single warning is logged.

## Install from source

```sh
make pack
gnome-extensions install --force dist/luciole@luciole.dev.shell-extension.zip
```

Log out and in again (Wayland cannot reload extensions), then enable it:

```sh
gnome-extensions enable luciole@luciole.dev
```

## Settings

`gnome-extensions prefs luciole@luciole.dev` opens the preferences: the
shortcut (with a warning when another GNOME shortcut already uses it), the
number of results per source, which sources are searched, excluded folders and
file types, and a button to clear the usage history.

## Privacy

- Nothing leaves the computer: no network access, no telemetry.
- The usage history (which results you open, to rank them) is kept in
  `~/.local/share/luciole/frecency.json`, readable by you only, and can be erased
  from the preferences.
- Your typing is never inserted in a database query: it is reduced to plain words
  and passed to the index as a bound value.

## Development

```sh
make check            # ESLint and unit tests (plain gjs, no shell needed)
make shell-test       # enable/disable cycles in an isolated headless shell
make shell-test-ui    # open/close cycles with the real shortcut
make shell-test-search  shell-test-files  shell-test-degrade
make capture          # PNG screenshots of the launcher, light and dark
make pot po locale    # translations
```

The shell tests start their own throw-away GNOME Shell on a private D-Bus
session with private settings, data and cache directories: the session you are
logged in to is never touched. See `docs/architecture.md` for how the code is
organised and how to add a new source of results, and `docs/performance.md` for
the performance budgets and how they are measured.
