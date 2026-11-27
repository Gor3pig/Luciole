// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {menuAnchor} from '../core/layout.js';

/**
 * The actions of a result in GNOME's own menu, the one of a right click on the
 * dock. It opens like a menu of Files: its top left corner at the point given
 * (the pointer, or the start of a row's name), going up instead when there is
 * no room below. It holds the keyboard while it is open.
 *
 * How it closed is reported once it has closed, never from inside the menu's
 * own signals (what follows may close the launcher, which destroys the menu):
 * the action chosen, a click outside it (where, which button) or a character
 * typed, which belongs to the search.
 */
export class ContextMenu {
    #menu;
    #manager;
    #report = {chosen: null, outside: null, typed: null};
    #onClosed;
    // Where the menu was asked to open, kept to place it again when it grows (a submenu unfolds).
    #anchor = null;
    #closing = false;
    #idleId = 0;
    #relayoutId = 0;

    /**
     * @param {object} options
     * @param {Clutter.Actor} options.owner - the launcher's window
     * @param {string} options.title - the result, shown at the top
     * @param {string} [options.subtitle] - where it is, or what it is, shown under the title
     * @param {Array<{index: number, label: string, hint?: string}>} options.entries - the actions, in
     *   order; `index` is the action's place in the launcher's list
     * @param {(report: {chosen: number[] | null, outside: {x: number, y: number, button: number} | null,
     *   typed: string | null}) => void} options.onClosed
     */
    constructor({owner, title, subtitle = '', entries, onClosed}) {
        this.#onClosed = onClosed;
        // Alignment 0 and a point as the source: the menu's left edge is at that point.
        const menu = new PopupMenu.PopupMenu(Main.layoutManager.dummyCursor, 0, St.Side.TOP);
        menu.actor.add_style_class_name('luciole-context-menu');

        menu.addMenuItem(this.#heading(title, subtitle));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        for (const entry of entries) {
            const row = new PopupMenu.PopupMenuItem(entry.label);
            if (entry.hint) {
                row.label.x_expand = true;
                // The key, dimmed whatever the theme, with room before it so a long action never
                // runs into it.
                row.add_child(new St.Label({text: entry.hint, opacity: 150, style: 'padding-left: 24px;', y_align: Clutter.ActorAlign.CENTER}));
            }
            row.connect('activate', () => {
                this.#report.chosen = [entry.index];
            });
            menu.addMenuItem(row);
        }

        Main.layoutManager.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        this.#manager = new PopupMenu.PopupMenuManager(owner);
        this.#manager.addMenu(menu);
        menu.connect('open-state-changed', (_menu, open) => {
            if (!open)
                this.#closed();
        });
        menu.actor.connect('captured-event', (_actor, event) => this.#onEvent(event));
        this.#menu = menu;
    }

    // The result the menu is about: its name, and under it where it is. Not a choice, yet not
    // greyed out like one that is unavailable.
    #heading(title, subtitle) {
        const heading = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        heading.add_style_class_name('luciole-context-heading');
        heading.remove_style_pseudo_class('insensitive');
        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        text.add_child(new St.Label({text: title, style: 'font-weight: bold;'}));
        if (subtitle)
            text.add_child(new St.Label({text: subtitle, opacity: 150, style: 'font-size: smaller;'}));
        heading.add_child(text);
        return heading;
    }

    /**
     * Opens the menu with its top left corner at a point of the screen, or under a box (a row),
     * above it when there is no room below.
     *
     * @param {{x: number, y: number, height?: number}} where - a point, or the box's left edge
     * @param {boolean} keyboard - opened from the keyboard: the first action is highlighted
     * @param {number | null} [floor] - what the menu must never cover above it (the field): when it
     *   fits neither below the box nor between the box and the floor, it opens just under the floor
     */
    open({x, y, height = 0}, keyboard, floor = null) {
        this.#anchor = {x, y, height, floor};
        this.#place();
        this.#menu.open();
        // GNOME highlights the first action when the key that opened the menu is still being
        // handled; here the actions were listed first, so it is done by hand.
        if (keyboard)
            this.#menu.actor.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
    }

    // Puts the menu where it is seen whole (see menuAnchor), for its size now plus `growing`: what a
    // submenu about to unfold will add (it unfolds from no height, so it is not counted yet).
    #place(growing = 0) {
        const {x, y, height, floor} = this.#anchor;
        const [, natural] = this.#menu.actor.get_preferred_height(-1);
        const area = Main.layoutManager.getWorkAreaForMonitor(monitorAt(x, y));
        const anchor = menuAnchor({y, height}, natural + growing, floor, {top: area.y, bottom: area.y + area.height});
        Main.layoutManager.setDummyCursorGeometry(x, anchor.y, 0, anchor.height);
        // GNOME places the menu where its anchor was when it was last laid out: once the anchor
        // has moved (the next cycle), the menu is laid out again to follow it.
        if (!this.#relayoutId) {
            this.#relayoutId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this.#relayoutId = 0;
                this.#menu?.actor.queue_relayout();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    /**
     * Adds a submenu at the end ("Open With…"), its choices known once the menu was open. Nothing
     * is added once the menu is closed, or without choices.
     *
     * @param {number} index - the action's place in the launcher's list
     * @param {string} label
     * @param {Array<{label: string}>} choices
     */
    addSubmenu(index, label, choices) {
        if (!this.#menu?.isOpen || choices.length === 0)
            return;
        const submenu = new PopupMenu.PopupSubMenuMenuItem(label);
        choices.forEach((choice, choiceIndex) => {
            const row = new PopupMenu.PopupMenuItem(choice.label);
            row.connect('activate', () => {
                this.#report.chosen = [index, choiceIndex];
            });
            submenu.menu.addMenuItem(row);
        });
        this.#menu.addMenuItem(submenu);
        // Unfolded or folded, the menu changes height: placed again so it stays on screen.
        submenu.menu.connect('open-state-changed', (_submenu, open) => {
            if (this.#menu?.isOpen)
                this.#place(open ? submenu.menu.box.get_preferred_height(-1)[1] : 0);
        });
    }

    get isOpen() {
        return Boolean(this.#menu?.isOpen);
    }

    // Whether an actor (the keyboard's, an event's) belongs to the menu.
    owns(actor) {
        return Boolean(actor && this.#menu?.actor.contains(actor));
    }

    destroy() {
        // Destroying an open menu closes it first: nothing is reported then.
        this.#closing = true;
        if (this.#idleId) {
            GLib.source_remove(this.#idleId);
            this.#idleId = 0;
        }
        if (this.#relayoutId) {
            GLib.source_remove(this.#relayoutId);
            this.#relayoutId = 0;
        }
        const menu = this.#menu;
        this.#menu = null;
        this.#manager = null;
        this.#onClosed = null;
        menu?.destroy();
    }

    // While the menu is open the keys come to it: Ctrl+K closes it, as it opened it; a character
    // typed closes it and is handed to the search.
    #onEvent(event) {
        if (event.type() !== Clutter.EventType.KEY_PRESS)
            return Clutter.EVENT_PROPAGATE;
        const state = event.get_state();
        const control = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const symbol = event.get_key_symbol();
        if (control && (symbol === Clutter.KEY_k || symbol === Clutter.KEY_K)) {
            this.#menu.close();
            return Clutter.EVENT_STOP;
        }
        const typed = printable(event, state);
        if (typed === null)
            return Clutter.EVENT_PROPAGATE;
        this.#report.typed = typed;
        this.#menu.close();
        return Clutter.EVENT_STOP;
    }

    #closed() {
        if (this.#closing)
            return;
        this.#closing = true;
        // GNOME closes its menu itself on a click outside it, with any button: the event being
        // handled is that click, reported so the launcher goes on with what it meant.
        const event = Clutter.get_current_event();
        if (!this.#report.chosen && !this.#report.outside && event?.type() === Clutter.EventType.BUTTON_PRESS) {
            const [x, y] = event.get_coords();
            this.#report.outside = {x, y, button: event.get_button()};
        }
        this.#idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this.#idleId = 0;
            this.#onClosed?.(this.#report);
            return GLib.SOURCE_REMOVE;
        });
    }
}

// The monitor that holds a point, else the primary one.
function monitorAt(x, y) {
    const index = Main.layoutManager.monitors.findIndex(monitor =>
        x >= monitor.x && x < monitor.x + monitor.width && y >= monitor.y && y < monitor.y + monitor.height);
    return index >= 0 ? index : Main.layoutManager.primaryIndex;
}

// The character a key types, when it is one for the search: not with Ctrl, Alt or Super, not Space
// (it chooses in a menu), not a control character. Null otherwise.
function printable(event, state) {
    const modifiers = Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.MOD1_MASK |
        Clutter.ModifierType.SUPER_MASK | Clutter.ModifierType.MOD4_MASK;
    if ((state & modifiers) !== 0)
        return null;
    const raw = event.get_key_unicode();
    // A character, or its code point, depending on the bindings.
    const code = typeof raw === 'number' ? (raw > 0 ? String.fromCodePoint(raw) : '') : raw;
    if (typeof code !== 'string' || code.length === 0)
        return null;
    const point = code.codePointAt(0);
    if (point <= 0x20 || point === 0x7f)
        return null;
    return code;
}
