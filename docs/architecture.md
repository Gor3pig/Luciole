# Architecture

Luciole is a GNOME Shell extension. The code is split in layers that only
depend on the ones below them, so most of it can be tested without a shell.

```
src/
├─ extension.js      enable() builds everything, disable() releases it all
├─ prefs.js          preferences (Adwaita, runs in its own process)
├─ ui/               the window (St/Clutter): launcher, results list, accessibility
├─ shell/            everything that touches GNOME Shell or the system
│  ├─ compat.js      the ONLY module that knows shell internals and version differences
│  ├─ scheduler.js   GLib timers behind the scheduler interface
│  ├─ persistence.js usage history file (asynchronous, private)
│  └─ perf.js        optional timing logs
├─ providers/        sources of results
│  ├─ apps.js, apps-index.js
│  └─ files.js, files-query.js
└─ core/             pure logic, no GNOME Shell, no GTK: runs under plain gjs
   ├─ text.js        folding (case and accents), word starts, highlight ranges
   ├─ matching.js    prefix, word prefix, initials, substring, fuzzy
   ├─ frecency.js    how often and how recently an item was used
   ├─ scoring.js     match quality + frecency
   ├─ merge.js       sections, top hit, selection and section jumps
   ├─ provider.js    the contract every source follows
   ├─ registry.js    knows the sources, starts the enabled ones
   ├─ session.js     the search controller
   ├─ disposables.js ordered clean-up, used by every layer
   └─ log.js         logger and error barriers
```

`eslint.config.js` enforces the layering: `src/core` may not import GNOME Shell,
GTK or Adwaita; the shell process may not import GTK; preferences may not import
shell modules.

## Life cycle

Nothing is created when the module is loaded or in a constructor. `enable()`
creates a `Disposables` registry and registers the clean-up of each thing right
after creating it (signal connections, timers, actors, the keyboard grab, the
shortcut). `disable()` disposes the registry, which runs the clean-ups in
reverse order and never lets one failure stop the others. The tests enable and
disable the extension hundreds of times and check the shell stays healthy and
its memory stable.

## What happens when you type

1. The entry's text changes: the launcher asks the `SearchController` to search.
2. The controller cancels the previous search (every search has its own
   `Gio.Cancellable`) and starts every enabled source **in parallel**. A source
   with a debounce waits that long first; the wait is cancelled by the next
   keystroke.
3. Each source runs behind its own error barrier and its own time limit. A slow,
   failing or stuck source is logged and ignored; it never delays or breaks the
   others.
4. Results are scored (`scoring.js`), weighted by the source's `scoreWeight`, and
   merged (`merge.js`) into a top hit and one section per source. Updates are
   coalesced to one per frame.
5. The launcher shows them. The selection follows the best result until the user
   moves it, after which late results never move it.

## Adding a source of results

A calculator, a web search or a bridge to GNOME search providers is one more
class in `src/providers/`, registered in `extension.js`. The core, the ranking
and the window do not change.

```js
import {Provider} from '../core/provider.js';

export class CalculatorProvider extends Provider {
    get id() { return 'calc'; }               // used in settings and history keys
    get name() { return _('Calculator'); }    // the section heading
    get priority() { return 5; }              // lower comes first
    get scoreWeight() { return 1; }           // below 1: less likely to be wanted
    get debounceMs() { return 0; }            // raise it for expensive sources
    get timeoutMs() { return 100; }           // given up on after this long

    // Asynchronous, and must stop early when options.cancellable is cancelled.
    async search(query, {cancellable, limit, emit}) {
        return [{
            id: query,                         // unique within the source
            title: '42',                       // shown, and the first thing matched
            subtitle: query,
            matchFields: [query],              // extra texts to match (optional)
            providerScore: 1,                  // when the source ranks itself (optional)
            frecencyKey: 'calc:42',            // to remember it was used (optional)
        }];
    }

    async activate(result) { /* copy the value, open something... */ }
}
```

Optional: `emptyQueryResults()` for what to show before typing, `secondaryActions()`
and `activateAction()` for `Ctrl+Enter`, `init()` / `destroy()` for set-up and
clean-up. Keep the part that turns raw data into results in a separate pure
module (like `files-query.js`) so it can be tested without the shell.

## Tests

- **Unit tests** (`tests/*.test.js`, `make test`): the pure logic, run with plain
  gjs. The search controller is driven by a fake scheduler, so debounce, time
  limits and cancellation are tested without waiting. The files provider is
  tested against a real TinySPARQL database kept in memory.
- **Shell tests** (`tests/shell/`): an isolated, headless GNOME Shell. Keys are
  typed through Mutter's remote-desktop interface, so the real shortcut and the
  real window are exercised; screenshots go through the screen-cast interface.
  Test applications and a stand-in file index are created on the fly.
- **Mutation checks**: for every test added or changed, the code under test was
  broken on purpose and the test had to fail.

## Themes

All colours and sizes live in two files, `stylesheet.css` (light) and
`stylesheet-dark.css` (dark); the shell loads the one matching the session. They
must define the same selectors and properties, which a test enforces. The code
only assigns style classes, so a theme is a pair of such files.
