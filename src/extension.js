import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Disposables} from './core/disposables.js';
import {createLogger} from './core/log.js';

export default class LucioleExtension extends Extension {
    // Nothing is created at import time or in the constructor: everything is
    // built in enable() and released by disable().

    enable() {
        const logger = createLogger();
        const disposables = new Disposables(error =>
            logger.error('cleanup failed', error));

        this._disposables = disposables;

        try {
            const settings = this.getSettings();
            const debugLogger = createLogger({
                isDebug: () => settings.get_boolean('debug-timings'),
            });
            this._log = debugLogger;
            disposables.add(() => {
                this._log = null;
            });

            debugLogger.debug('enabled');
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
