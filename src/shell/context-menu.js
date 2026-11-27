// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

/**
 * The actions of a result in GNOME's own menu, the one of a right click on the
 * dock: it opens over the launcher, holds the keyboard while it is open, and
 * gives it back to the launcher's field when it closes.
 *
 * What was chosen is reported once the menu has closed, never from inside the
 * menu's own signals: the action may close the launcher, which destroys the menu.
 */
export class ContextMenu {
    #menu;
    #manager;
    #chosen = null;
    #onClosed;
    #closing = false;
    #idleId = 0;

    /**
     * @param {object} options
     * @param {Clutter.Actor} options.owner - the launcher's window
     * @param {string} options.title - the result, shown at the top
     * @param {Array<{label: string, hint?: string, choices?: Array<{label: string}>}>} options.entries -
     *   the actions, in order; one with choices is a submenu ("Open With…")
     * @param {(chosen: number[] | null) => void} options.onClosed - the index of the action (and of the
     *   choice in a submenu) chosen, or null when the menu was left
     */
    constructor({owner, title, entries, onClosed}) {
        this.#onClosed = onClosed;
        const menu = new PopupMenu.PopupMenu(Main.layoutManager.dummyCursor, 0.5, St.Side.TOP);
        menu.actor.add_style_class_name('luciole-context-menu');

        const heading = new PopupMenu.PopupMenuItem(title, {reactive: false, can_focus: false});
        heading.label.set_style('font-weight: bold;');
        menu.addMenuItem(heading);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        entries.forEach((entry, index) => {
            if (Array.isArray(entry.choices)) {
                const submenu = new PopupMenu.PopupSubMenuMenuItem(entry.label);
                entry.choices.forEach((choice, choiceIndex) => {
                    const row = new PopupMenu.PopupMenuItem(choice.label);
                    row.connect('activate', () => this.#choose([index, choiceIndex]));
                    submenu.menu.addMenuItem(row);
                });
                menu.addMenuItem(submenu);
                return;
            }
            const row = new PopupMenu.PopupMenuItem(entry.label);
            if (entry.hint) {
                row.label.x_expand = true;
                // The key, dimmed whatever the theme, with room before it so a long action never
                // runs into it.
                row.add_child(new St.Label({text: entry.hint, opacity: 150, style: 'padding-left: 24px;', y_align: Clutter.ActorAlign.CENTER}));
            }
            row.connect('activate', () => this.#choose([index]));
            menu.addMenuItem(row);
        });

        Main.layoutManager.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        this.#manager = new PopupMenu.PopupMenuManager(owner);
        this.#manager.addMenu(menu);
        menu.connect('open-state-changed', (_menu, open) => {
            if (!open)
                this.#closed();
        });
        this.#menu = menu;
    }

    /**
     * Opens the menu pointing at a place on screen: a point (a right click) or a box (a row).
     *
     * @param {{x: number, y: number, width: number, height: number}} where
     * @param {boolean} keyboard - opened from the keyboard: the first action is highlighted
     */
    open({x, y, width, height}, keyboard) {
        Main.layoutManager.setDummyCursorGeometry(x, y, width, height);
        this.#menu.open();
        // GNOME highlights the first action when the key that opened the menu is still being
        // handled; here the actions were listed first, so it is done by hand.
        if (keyboard)
            this.#menu.actor.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
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
        const menu = this.#menu;
        this.#menu = null;
        this.#manager = null;
        this.#onClosed = null;
        menu?.destroy();
    }

    #choose(path) {
        this.#chosen = path;
    }

    #closed() {
        if (this.#closing)
            return;
        this.#closing = true;
        this.#idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this.#idleId = 0;
            this.#onClosed?.(this.#chosen);
            return GLib.SOURCE_REMOVE;
        });
    }
}
