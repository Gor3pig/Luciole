// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// GNOME's file previewer (Sushi), the one the Files application uses.
const NAME = 'org.gnome.NautilusPreviewer';
const PATH = '/org/gnome/NautilusPreviewer';
const IFACE = 'org.gnome.NautilusPreviewer2';
// If the preview has not shown up by then, it is not coming.
const SHOW_TIMEOUT_MS = 2000;

// The previewer's window, as the shell sees it.
function isPreviewWindow(window) {
    return window?.get_gtk_application_id?.() === NAME || window?.get_wm_class?.() === NAME;
}

// The previewer is not started by the user's own click, so the shell would not give its window the
// keyboard (focus stealing prevention): the shell, asked by the user's key press, gives it here.
function focusPreviewWindow() {
    const actor = global.get_window_actors().find(candidate => isPreviewWindow(candidate.meta_window));
    if (actor)
        Main.activateWindow(actor.meta_window);
    return Boolean(actor);
}

/**
 * Shows a file in GNOME's previewer and says when the preview is gone. One preview at a time:
 * showing another, or cancel(), ends the previous one without calling it back.
 */
export class Previewer {
    #bus;
    #log;
    #available = false;
    #current = null;

    constructor({log, bus = Gio.DBus.session}) {
        this.#log = log;
        this.#bus = bus;
    }

    /** Whether the previewer is installed (or running) on this session. */
    get available() {
        return this.#available;
    }

    async init() {
        const names = method => new Promise(resolve => {
            this.#bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', method,
                null, new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, -1, null, (bus, result) => {
                    try {
                        resolve(bus.call_finish(result).deepUnpack()[0]);
                    } catch {
                        resolve([]);
                    }
                });
        });
        const [activatable, running] = await Promise.all([names('ListActivatableNames'), names('ListNames')]);
        this.#available = activatable.includes(NAME) || running.includes(NAME);
        this.#log.debug(`file previewer ${this.#available ? 'found' : 'not installed'}`);
    }

    /**
     * Shows a local file. `onDone(reason)` is called once, when the preview was closed ('closed'),
     * never appeared ('timeout') or could not be asked for ('error'); not after cancel().
     */
    show(uri, onDone) {
        this.cancel();
        if (!this.#available || typeof uri !== 'string' || !uri.startsWith('file:///')) {
            onDone('error');
            return;
        }
        const current = {onDone, seen: false, subscription: 0, timer: 0, windowCreated: 0, focusTimer: 0};
        this.#current = current;
        current.subscription = this.#bus.signal_subscribe(null, 'org.freedesktop.DBus.Properties', 'PropertiesChanged',
            PATH, IFACE, Gio.DBusSignalFlags.NONE, (_bus, _sender, _path, _iface, _signal, params) => {
                const visible = params.deepUnpack()[1]?.Visible?.deepUnpack?.();
                if (visible === true) {
                    current.seen = true;
                    // The window may already be there (a preview already open), or come a moment later.
                    this.#focusSoon(current);
                } else if (visible === false) {
                    this.#log.debug('preview closed');
                }
                if (visible === false && current.seen)
                    this.#finish(current, 'closed');
            });
        // Its window may appear after the property says so: give it the keyboard as it comes.
        current.windowCreated = global.display.connect('window-created', (_display, window) => {
            if (isPreviewWindow(window))
                this.#focusSoon(current);
        });
        current.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SHOW_TIMEOUT_MS, () => {
            current.timer = 0;
            if (!current.seen)
                this.#finish(current, 'timeout');
            return GLib.SOURCE_REMOVE;
        });
        this.#bus.call(NAME, PATH, IFACE, 'ShowFile', new GLib.Variant('(ssbs)', [uri, '', false, '']),
            null, Gio.DBusCallFlags.NONE, -1, null, (bus, result) => {
                try {
                    bus.call_finish(result);
                } catch (error) {
                    this.#log.warn(`the file previewer failed: ${error.message}`);
                    this.#finish(current, 'error');
                }
            });
    }

    /** Stops following the current preview, without calling it back. The preview stays on screen. */
    cancel() {
        if (this.#current)
            this.#release(this.#current);
    }

    destroy() {
        this.cancel();
    }

    // Gives the preview window the keyboard as soon as the shell shows it (tried for a second).
    #focusSoon(current) {
        if (current.focusTimer)
            return;
        let tries = 0;
        current.focusTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            if (focusPreviewWindow()) {
                this.#log.debug('preview window given the keyboard');
            } else if (++tries < 20) {
                return GLib.SOURCE_CONTINUE;
            }
            current.focusTimer = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    #finish(current, reason) {
        if (this.#current !== current)
            return;
        this.#release(current);
        current.onDone(reason);
    }

    #release(current) {
        if (current.subscription)
            this.#bus.signal_unsubscribe(current.subscription);
        if (current.timer)
            GLib.source_remove(current.timer);
        if (current.windowCreated)
            global.display.disconnect(current.windowCreated);
        if (current.focusTimer)
            GLib.source_remove(current.focusTimer);
        current.focusTimer = 0;
        current.windowCreated = 0;
        current.subscription = 0;
        current.timer = 0;
        if (this.#current === current)
            this.#current = null;
    }
}
