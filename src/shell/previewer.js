// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// GNOME's file previewer (Sushi), the one the Files application uses.
const NAME = 'org.gnome.NautilusPreviewer';
const PATH = '/org/gnome/NautilusPreviewer';
const IFACE = 'org.gnome.NautilusPreviewer2';
// If the preview has not shown up by then (and no window of it is on screen), it is not coming.
// The previewer may take a few seconds to start the first time.
const SHOW_TIMEOUT_MS = 5000;

// The previewer's window, as the shell sees it.
function isPreviewWindow(window) {
    return window?.get_gtk_application_id?.() === NAME || window?.get_wm_class?.() === NAME;
}

function previewWindowShown() {
    return global.get_window_actors().some(candidate => isPreviewWindow(candidate.meta_window));
}

// The previewer is not started by the user's own click, so the shell would not give its window the
// keyboard (focus stealing prevention): the shell, asked by the user's key press, gives it here.
function focusPreviewWindow() {
    const actor = global.get_window_actors().find(candidate => isPreviewWindow(candidate.meta_window));
    if (actor) {
        Main.activateWindow(actor.meta_window);
        // The keys go to the window only when nothing of the shell keeps the keyboard: opened over
        // the overview, the launcher otherwise hands it back to the overview's controls.
        global.stage.set_key_focus(null);
    }
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
                    this.#seen(current);
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
            // A window of the previewer on screen means the preview is there, whatever was heard.
            if (!current.seen && previewWindowShown())
                this.#seen(current);
            if (!current.seen)
                this.#finish(current, 'timeout');
            return GLib.SOURCE_REMOVE;
        });
        // A preview already on screen shows the new file without its Visible property changing:
        // whether one is there is read first (without starting the previewer for that).
        this.#readVisible(alreadyShown => {
            if (this.#current !== current)
                return;
            this.#bus.call(NAME, PATH, IFACE, 'ShowFile', new GLib.Variant('(ssbs)', [uri, '', false, '']),
                null, Gio.DBusCallFlags.NONE, -1, null, (bus, result) => {
                    try {
                        bus.call_finish(result);
                    } catch (error) {
                        this.#log.warn(`the file previewer failed: ${error.message}`);
                        this.#finish(current, 'error');
                        return;
                    }
                    if (alreadyShown)
                        this.#seen(current);
                });
        });
    }

    // Calls back with whether a preview is on screen now; false when the previewer is not running.
    #readVisible(callback) {
        this.#bus.call(NAME, PATH, 'org.freedesktop.DBus.Properties', 'Get', new GLib.Variant('(ss)', [IFACE, 'Visible']),
            new GLib.VariantType('(v)'), Gio.DBusCallFlags.NO_AUTO_START, 1000, null, (bus, result) => {
                let visible = false;
                try {
                    visible = bus.call_finish(result).deepUnpack()[0].deepUnpack() === true;
                } catch {
                    // Not running, or not answering: no preview is on screen.
                }
                callback(visible);
            });
    }

    // The preview is on screen: its end can now be noticed, and its window is given the keyboard
    // (it may already be there, or come a moment later).
    #seen(current) {
        if (this.#current !== current)
            return;
        current.seen = true;
        this.#focusSoon(current);
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
