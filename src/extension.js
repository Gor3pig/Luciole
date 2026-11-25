import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Disposables} from './core/disposables.js';
import {createLogger} from './core/log.js';
import * as compat from './shell/compat.js';
import {measure} from './shell/perf.js';
import {Launcher} from './ui/launcher.js';

const SHORTCUT_KEY = 'toggle-shortcut';

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

            // Registered first, so it is destroyed last (reverse order).
            const launcher = new Launcher({log, gettext: this.gettext.bind(this)});
            disposables.add(() => launcher.destroy());

            const close = () => log.guard('close', () => launcher.close());
            compat.connectScreenLock(disposables, close);
            compat.connectSessionModeChanged(disposables, close);
            compat.connectMonitorsChanged(disposables, () =>
                log.guard('relayout', () => launcher.relayout()));

            compat.addKeybinding(settings, SHORTCUT_KEY, () =>
                log.guard('toggle', () =>
                    measure(log, launcher.isOpen ? 'close' : 'open', () => launcher.toggle())));
            disposables.add(() => compat.removeKeybinding(SHORTCUT_KEY));

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

    _teardown() {
        const disposables = this._disposables;
        this._disposables = null;
        disposables?.dispose();
    }
}
