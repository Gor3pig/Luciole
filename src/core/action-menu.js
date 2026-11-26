// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// The actions of one result, as a menu that can go one level deeper ("Open With..."). Pure state:
// the window draws it and turns key presses into these calls.

import {sanitizeLabel} from './text.js';

export const MAX_ACTIONS = 24;
// A path or a name put on the clipboard: far longer than any real one, short enough to be harmless.
export const MAX_COPY_CHARS = 4096;

/**
 * What a provider hands over as "actions" is untrusted data: this keeps only well-formed ones,
 * with texts cleaned like result names, at most MAX_ACTIONS, without two of the same id.
 *
 * @param {unknown} list
 * @returns {Array<{id: string, label: string, hint?: string, submenu?: true, copy?: string, confirmation?: string}>}
 */
export function cleanActions(list) {
    if (!Array.isArray(list))
        return [];
    const seen = new Set();
    const clean = [];
    for (const raw of list) {
        if (clean.length >= MAX_ACTIONS)
            break;
        if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || raw.id === '' || raw.id.length > 200 || seen.has(raw.id))
            continue;
        const label = sanitizeLabel(raw.label);
        if (label === '')
            continue;
        seen.add(raw.id);
        const action = {id: raw.id, label};
        const hint = sanitizeLabel(raw.hint);
        if (hint !== '')
            action.hint = hint;
        if (raw.submenu === true)
            action.submenu = true;
        if (typeof raw.copy === 'string' && raw.copy !== '' && raw.copy.length <= MAX_COPY_CHARS)
            action.copy = raw.copy;
        const confirmation = sanitizeLabel(raw.confirmation);
        if (confirmation !== '')
            action.confirmation = confirmation;
        clean.push(action);
    }
    return clean;
}

export class ActionMenu {
    /** @type {Array<{title: string, actions: object[], index: number}>} */
    #levels = [];

    /** True while a menu is shown. */
    get isOpen() {
        return this.#levels.length > 0;
    }

    /** How many levels deep: 0 closed, 1 the actions, 2 a submenu. */
    get depth() {
        return this.#levels.length;
    }

    get title() {
        return this.#levels[this.#levels.length - 1]?.title ?? '';
    }

    get actions() {
        return [...(this.#levels[this.#levels.length - 1]?.actions ?? [])];
    }

    get index() {
        return this.#levels[this.#levels.length - 1]?.index ?? -1;
    }

    /** The highlighted action, or null. */
    get selected() {
        const level = this.#levels[this.#levels.length - 1];
        return level?.actions[level.index] ?? null;
    }

    /** Opens the menu for a result: one level, the first action highlighted. Nothing to show: stays closed. */
    open(title, actions) {
        this.#levels = [];
        if (Array.isArray(actions) && actions.length > 0)
            this.#levels.push({title: String(title ?? ''), actions: [...actions], index: 0});
    }

    /** Goes one level deeper. Nothing to show there: the menu stays as it was. Returns whether it did. */
    push(title, actions) {
        if (!this.isOpen || !Array.isArray(actions) || actions.length === 0)
            return false;
        this.#levels.push({title: String(title ?? ''), actions: [...actions], index: 0});
        return true;
    }

    /** Goes back one level, or closes the menu from the first one. Returns what is left open. */
    back() {
        this.#levels.pop();
        return this.isOpen;
    }

    close() {
        this.#levels = [];
    }

    /** Moves the highlight, wrapping around. */
    move(delta) {
        const level = this.#levels[this.#levels.length - 1];
        if (!level || !Number.isInteger(delta))
            return;
        const count = level.actions.length;
        level.index = (((level.index + delta) % count) + count) % count;
    }

    /** Highlights an action by its position (a click). Out of range: nothing changes. */
    select(index) {
        const level = this.#levels[this.#levels.length - 1];
        if (level && Number.isInteger(index) && index >= 0 && index < level.actions.length)
            level.index = index;
    }
}
