// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Disposables} from './core/disposables.js';
import {createLogger} from './core/log.js';
import {ProviderRegistry} from './core/registry.js';
import {SearchController} from './core/session.js';
import {AppsProvider} from './providers/apps.js';
import {CalcProvider} from './providers/calc.js';
import {FilesProvider} from './providers/files.js';
import {SystemProvider} from './providers/system.js';
import * as compat from './shell/compat.js';
import {FrecencyStore, QueryHistoryStore} from './shell/persistence.js';
import {measure} from './shell/perf.js';
import {Previewer} from './shell/previewer.js';
import {GLibScheduler} from './shell/scheduler.js';
import {Launcher} from './ui/launcher.js';

const SHORTCUT_KEY = 'toggle-shortcut';
// Most results the window shows, whatever the providers return.
const MAX_TOTAL_RESULTS = 12;

export default class LucioleExtension extends Extension {
    // Nothing is created at import time or in the constructor: everything is
    // built in enable() and released by disable().

    enable() {
        const bootLog = createLogger();
        const disposables = new Disposables(error =>
            bootLog.error('cleanup failed', error));

        this._disposables = disposables;

        try {
            const settings = this.getSettings();
            const log = createLogger({
                isDebug: () => settings.get_boolean('debug-timings'),
            });
            this._log = log;
            disposables.add(() => {
                this._log = null;
            });

            const scheduler = new GLibScheduler();
            disposables.add(() => scheduler.destroy());

            // Set once the history is loaded and the providers have started.
            const backend = {controller: null, queryHistory: null};

            const previewer = new Previewer({log});
            disposables.add(() => previewer.destroy());
            log.guardAsync('looking for the file previewer', () => previewer.init());

            // Registered early, so it is destroyed late (reverse order).
            const launcher = new Launcher({
                log,
                gettext: this.gettext.bind(this),
                onQuery: query => backend.controller?.search(query),
                onActivate: item => backend.controller?.activate(item),
                onSecondary: item => backend.controller?.activateSecondary(item),
                getBackdrop: () => settings.get_string('backdrop'),
                getAnimations: () => settings.get_boolean('animations'),
                getActions: item => backend.controller?.actionsFor(item) ?? Promise.resolve([]),
                getSubActions: (item, action) => backend.controller?.subActionsFor(item, action) ?? Promise.resolve([]),
                onRunAction: (item, action) => backend.controller?.runAction(item, action) ?? Promise.resolve({ok: false, confirmation: null}),
                previewer,
                getPreviewUri: item => backend.controller?.previewUriFor(item) ?? Promise.resolve(null),
                getCategories: () => backend.controller?.categories() ?? [],
                onFilter: id => backend.controller?.setFilter(id),
                getQueries: () => (settings.get_boolean('remember-queries') ? backend.queryHistory?.entries ?? [] : []),
            });
            disposables.add(() => launcher.destroy());

            const close = () => log.guard('close', () => launcher.close());
            compat.connectScreenLock(disposables, close);
            compat.connectSessionModeChanged(disposables, close);
            // A monitor appeared or went away while the launcher was open: close it rather than
            // move it under the user's eyes.
            compat.connectMonitorsChanged(disposables, close);

            compat.addKeybinding(settings, SHORTCUT_KEY, () =>
                log.guard('toggle', () =>
                    measure(log, launcher.isOpen ? 'close' : 'open', () => launcher.toggle())));
            disposables.add(() => compat.removeKeybinding(SHORTCUT_KEY));

            log.guardAsync('starting the search', () =>
                this._startSearch({settings, log, scheduler, launcher, backend, disposables}));

            log.debug(`enabled on GNOME Shell ${compat.SHELL_MAJOR_VERSION}`);
        } catch (error) {
            // Leave nothing half-built, then let the shell report the failure.
            this._teardown();
            throw error;
        }
    }

    disable() {
        this._log?.debug('disabling');
        this._teardown();
    }

    // Loads the history, then starts the providers. Runs in the background after
    // enable() returned; if the extension is disabled meanwhile, it stops at once.
    async _startSearch({settings, log, scheduler, launcher, backend, disposables}) {
        const store = new FrecencyStore({log, scheduler});
        const queryStore = new QueryHistoryStore({log, scheduler});
        const [frecency, queryHistory] = await Promise.all([store.load(), queryStore.load()]);
        if (disposables.disposed)
            return;
        // Last in, first out: the histories are saved after everything else stopped.
        disposables.add(() => store.save(frecency));
        disposables.add(() => queryStore.save(queryHistory));
        backend.queryHistory = queryHistory;
        disposables.add(() => {
            backend.queryHistory = null;
        });

        // The preferences ask for the history to be erased by changing this counter.
        disposables.connect(settings, 'changed::history-generation', () => {
            frecency.clear();
            store.save(frecency);
            queryHistory.clear();
            queryStore.save(queryHistory);
            log.debug('usage and search history erased');
        });
        // Turning the remembering off also forgets what was remembered.
        disposables.connect(settings, 'changed::remember-queries', () => {
            if (settings.get_boolean('remember-queries'))
                return;
            queryHistory.clear();
            queryStore.save(queryHistory);
            log.debug('remembered searches erased');
        });
        if (!settings.get_boolean('remember-queries')) {
            queryHistory.clear();
            queryStore.save(queryHistory);
        }

        const registry = new ProviderRegistry({log});
        registry.register('apps', () => new AppsProvider());
        const fileOptions = {copyFile: uri => compat.copyFile(uri), spawn: argv => compat.spawn(argv)};
        registry.register('files', () => new FilesProvider(fileOptions));
        registry.register('folders', () => new FilesProvider({kind: 'folders', ...fileOptions}));
        registry.register('system', () => new SystemProvider());
        registry.register('calc', () => new CalcProvider({copyText: text => compat.copyText(text)}));
        disposables.add(() => registry.stop());

        const controller = new SearchController({
            getProviders: () => registry.providers,
            frecency,
            scheduler,
            log,
            onUpdate: (merged, state) => measure(log, 'show results', () => launcher.showResults(merged, state)),
            onFrecencyChange: () => store.scheduleSave(frecency),
            gettext: this.gettext.bind(this),
            copyText: text => compat.copyText(text),
            queryHistory,
            rememberQueries: () => settings.get_boolean('remember-queries'),
            onQueryHistoryChange: () => queryStore.scheduleSave(queryHistory),
            mergeOptions: {maxTotal: MAX_TOTAL_RESULTS},
        });
        disposables.add(() => controller.dispose());

        await registry.start(
            {settings, frecency, log, scheduler, gettext: this.gettext.bind(this)},
            settings.get_strv('providers-enabled'));
        if (disposables.disposed) {
            registry.stop();
            return;
        }
        backend.controller = controller;
        log.debug(`search ready: ${registry.providers.map(p => p.id).join(', ')}`);
        // The launcher may already be open: show the recent items.
        if (launcher.isOpen)
            controller.search('');
    }

    _teardown() {
        const disposables = this._disposables;
        this._disposables = null;
        disposables?.dispose();
    }
}
