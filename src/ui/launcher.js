// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {backdropClass, verticalLayout} from '../core/layout.js';
import {jumpSection, nextSelection} from '../core/merge.js';
import * as compat from '../shell/compat.js';
import {describeWindow} from './a11y.js';
import {ResultsView} from './results-view.js';

const OPEN_MS = 120;
const CLOSE_MS = 90;
const SLIDE_PX = 8;

/**
 * Keys that mean "I am going elsewhere": the Super key (Activities) and Alt+Tab
 * (windows). While the launcher holds the keyboard the shell ignores them, so
 * the launcher closes instead of leaving the user facing a window that seems
 * to ignore the system.
 */
function isLeaveKey(event) {
    const symbol = event.get_key_symbol();
    if (symbol === Clutter.KEY_Super_L || symbol === Clutter.KEY_Super_R)
        return true;
    const alt = (event.get_state() & Clutter.ModifierType.MOD1_MASK) !== 0;
    return alt && (symbol === Clutter.KEY_Tab || symbol === Clutter.KEY_ISO_Left_Tab);
}

/**
 * The floating launcher window: a full-monitor overlay that holds the input
 * grab, with the panel centred near the top. Appearance lives entirely in
 * stylesheet.css (and its dark variant); this file only assigns style classes.
 *
 * Actors are built on first open and kept hidden afterwards, so reopening is
 * cheap. destroy() releases everything.
 */
export class Launcher {
    #log;
    #gettext;
    #onQuery;
    #onActivate;
    #onSecondary;
    #getBackdrop;
    #overlay = null;
    #panel = null;
    #entry = null;
    #view = null;
    #grab = null;
    #stopFocusWatch = null;
    #isOpen = false;
    #items = [];
    #merged = null;
    #selectedKey = null;
    #navigated = false;
    #queryAt = 0;
    #doneAt = 0;

    /**
     * @param {object} options
     * @param {object} options.log
     * @param {(text: string) => string} options.gettext
     * @param {(query: string) => void} options.onQuery - the text changed (also called with '' on open)
     * @param {(item: object) => void} options.onActivate - the user chose a result
     * @param {(item: object) => void} options.onSecondary - the user asked for the other action (Ctrl+Enter)
     * @param {() => string} options.getBackdrop - the dimming setting: 'none', 'light' or 'standard'
     */
    constructor({log, gettext, onQuery, onActivate, onSecondary, getBackdrop}) {
        this.#log = log;
        this.#gettext = gettext;
        this.#onQuery = onQuery;
        this.#onActivate = onActivate;
        this.#onSecondary = onSecondary;
        this.#getBackdrop = getBackdrop;
    }

    get isOpen() {
        return this.#isOpen;
    }

    toggle() {
        if (this.#isOpen)
            this.close();
        else
            this.open();
    }

    open() {
        if (this.#isOpen || compat.isScreenLocked())
            return;

        this.#ensureBuilt();
        this.#place();
        this.#applyBackdrop();
        this.#items = [];
        this.#merged = null;
        this.#selectedKey = null;
        this.#navigated = false;
        this.#entry.set_text('');
        this.#overlay.remove_all_transitions();
        this.#panel.remove_all_transitions();
        this.#overlay.show();

        try {
            this.#grab = compat.pushModal(this.#overlay);
        } catch (error) {
            this.#log.error('could not grab the keyboard', error);
            this.#overlay.hide();
            return;
        }
        this.#isOpen = true;
        this.#entry.grab_key_focus();
        // If the keyboard goes anywhere else (the overview taking it, a dialog, a
        // widget that disappears), nothing typed would reach the launcher any more
        // and it could not even be closed with Escape: it closes instead.
        this.#stopFocusWatch = compat.connectKeyFocus(() => this.#checkFocus());
        this.#log.debug('opened');
        this.#log.guard('searching the recent items', () => this.#onQuery(''));

        if (compat.useMotion()) {
            this.#overlay.opacity = 0;
            this.#panel.translation_y = -SLIDE_PX;
            this.#overlay.ease({
                opacity: 255,
                duration: OPEN_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            this.#panel.ease({
                translation_y: 0,
                duration: OPEN_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            this.#overlay.opacity = 255;
            this.#panel.translation_y = 0;
        }
    }

    close() {
        if (!this.#isOpen)
            return;
        this.#isOpen = false;
        this.#unwatchFocus();
        this.#releaseGrab();
        this.#view.clear();
        this.#log.debug('closed');

        const overlay = this.#overlay;
        if (compat.useMotion()) {
            overlay.ease({
                opacity: 0,
                duration: CLOSE_MS,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (!this.#isOpen && this.#overlay === overlay)
                        overlay.hide();
                },
            });
        } else {
            overlay.hide();
        }
    }

    /**
     * Shows what the search found. The selection follows the best result until
     * the user moves it, then stays on the same item as results come in.
     *
     * @param {ReturnType<import('../core/merge.js').mergeResults>} merged
     * @param {{done: boolean}} [state] - done when every provider has answered
     */
    showResults(merged, state = {done: false}) {
        if (!this.#view || !this.#isOpen)
            return;
        this.#merged = merged;
        this.#items = merged.items;
        this.#selectedKey = nextSelection(this.#selectedKey, this.#items, this.#navigated);
        this.#view.update(merged, this.#selectedKey);
        if (this.#queryAt) {
            const ms = (GLib.get_monotonic_time() - this.#queryAt) / 1000;
            this.#log.debug(`perf query to results: ${ms.toFixed(2)} ms`);
            this.#queryAt = 0;
        }
        if (state.done && this.#doneAt) {
            const ms = (GLib.get_monotonic_time() - this.#doneAt) / 1000;
            this.#log.debug(`perf query to final results: ${ms.toFixed(2)} ms`);
        }
        const first = merged.topHit ?? merged.items[0];
        this.#log.debug(`results: ${merged.items.length} first=${first ? first.result.title : '-'} query=${this.#entry.get_text()}`);
    }

    destroy() {
        this.#isOpen = false;
        this.#unwatchFocus();
        this.#releaseGrab();
        if (this.#overlay) {
            this.#overlay.remove_all_transitions();
            this.#panel.remove_all_transitions();
            this.#overlay.destroy();
        }
        this.#overlay = null;
        this.#panel = null;
        this.#entry = null;
        this.#view = null;
        this.#items = [];
    }

    #moveSelection(delta) {
        if (this.#items.length === 0)
            return;
        const current = this.#items.findIndex(item => item.key === this.#selectedKey);
        const next = Math.min(this.#items.length - 1, Math.max(0, current + delta));
        this.#choose(this.#items[next].key);
        this.#navigated = true;
    }

    #choose(key) {
        this.#selectedKey = key;
        this.#view.select(key);
        this.#log.debug(`selected: ${key}`);
    }

    #jumpSection(direction) {
        if (!this.#merged)
            return;
        const key = jumpSection(this.#merged, this.#selectedKey, direction);
        if (key === null)
            return;
        this.#choose(key);
        this.#navigated = true;
    }

    #activate(item) {
        this.#log.guard('activating a result', () => this.#onActivate(item));
        this.close();
    }

    #activateSecondary() {
        const item = this.#items.find(candidate => candidate.key === this.#selectedKey);
        if (!item)
            return;
        this.#log.guard('running the secondary action', () => this.#onSecondary(item));
        this.close();
    }

    #activateSelected() {
        const item = this.#items.find(candidate => candidate.key === this.#selectedKey);
        if (item)
            this.#activate(item);
    }

    #checkFocus() {
        if (!this.#isOpen || !this.#overlay)
            return;
        const focus = compat.keyFocusActor();
        if (focus && this.#overlay.contains(focus))
            return;
        this.#log.debug('keyboard focus left the launcher');
        this.close();
    }

    #unwatchFocus() {
        const stop = this.#stopFocusWatch;
        this.#stopFocusWatch = null;
        if (stop)
            stop();
    }

    #releaseGrab() {
        const grab = this.#grab;
        this.#grab = null;
        if (!grab)
            return;
        try {
            compat.popModal(grab);
        } catch (error) {
            this.#log.error('could not release the keyboard', error);
        }
    }

    #place() {
        const monitor = compat.activeMonitor();
        if (!monitor)
            return;
        const {top, resultsMax} = verticalLayout(monitor.height);
        this.#overlay.set_position(monitor.x, monitor.y);
        this.#overlay.set_size(monitor.width, monitor.height);
        this.#overlay.set_style(`padding-top: ${top}px;`);
        this.#view.setMaxHeight(resultsMax);
    }

    // Read at every opening, so a change in the preferences applies at once.
    #applyBackdrop() {
        const level = this.#log.guard('reading the backdrop setting', () => this.#getBackdrop(), 'none');
        const extra = backdropClass(level);
        this.#overlay.set_style_class_name(extra ? `luciole-overlay ${extra}` : 'luciole-overlay');
    }

    #ensureBuilt() {
        if (this.#overlay)
            return;

        const _ = this.#gettext;
        const entry = new St.Entry({
            style_class: 'luciole-entry',
            hint_text: _('Search applications and files'),
            can_focus: true,
            x_expand: true,
        });
        entry.set_primary_icon(new St.Icon({
            style_class: 'luciole-entry-icon',
            icon_name: 'edit-find-symbolic',
        }));
        entry.accessible_name = _('Search');

        const view = new ResultsView({
            gettext: this.#gettext,
            onActivate: item => this.#activate(item),
        });

        const panel = new St.BoxLayout({
            style_class: 'luciole-panel',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
        });
        panel.add_child(entry);
        panel.add_child(view.actor);

        // A vertical box stacks its child from the top; x_align centres it.
        // (St.Bin ignores the alignment here, so it is not used.)
        panel.x_align = Clutter.ActorAlign.CENTER;
        const overlay = new St.BoxLayout({
            style_class: 'luciole-overlay',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
            visible: false,
        });
        overlay.add_child(panel);
        describeWindow(overlay, _('Luciole search'));

        const text = entry.clutter_text;
        text.connect('text-changed', () => {
            this.#queryAt = GLib.get_monotonic_time();
            this.#doneAt = this.#queryAt;
            this.#navigated = false;
            this.#log.guard('searching', () => this.#onQuery(entry.get_text()));
        });
        text.connect('activate', () => {
            this.#activateSelected();
            return Clutter.EVENT_STOP;
        });
        text.connect('key-press-event', (_actor, event) => {
            if (isLeaveKey(event)) {
                this.close();
                return Clutter.EVENT_PROPAGATE;
            }
            const symbol = event.get_key_symbol();
            const control = (event.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0;
            if (control && (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter)) {
                this.#activateSecondary();
                return Clutter.EVENT_STOP;
            }
            switch (symbol) {
            case Clutter.KEY_Down:
                this.#moveSelection(1);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Up:
                this.#moveSelection(-1);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Tab:
                this.#jumpSection(1);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_ISO_Left_Tab:
                this.#jumpSection(-1);
                return Clutter.EVENT_STOP;
            default:
                return Clutter.EVENT_PROPAGATE;
            }
        });

        overlay.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Escape)
                return Clutter.EVENT_PROPAGATE;
            // Escape clears the text first, then closes.
            if (entry.get_text() !== '')
                entry.set_text('');
            else
                this.close();
            return Clutter.EVENT_STOP;
        });

        overlay.connect('button-press-event', (_actor, event) => {
            // A click anywhere but on the panel closes the launcher.
            const target = compat.eventActor(event);
            if (target && panel.contains(target))
                return Clutter.EVENT_PROPAGATE;
            this.close();
            return Clutter.EVENT_STOP;
        });

        compat.addToUiGroup(overlay);
        this.#overlay = overlay;
        this.#panel = panel;
        this.#entry = entry;
        this.#view = view;
    }
}
