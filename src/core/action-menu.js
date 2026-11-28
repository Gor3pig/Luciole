// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// The actions of one result, as a menu. Pure state:
// the window draws it and turns key presses into these calls.

import {sanitizeLabel} from './text.js';

export const MAX_ACTIONS = 24;
// A path or a name put on the clipboard: far longer than any real one, short enough to be harmless.
export const MAX_COPY_CHARS = 4096;
// The family an action belongs to (open, place, copy...): a short lowercase word.
const GROUP_PATTERN = /^[a-z][a-z-]{0,31}$/;

/**
 * What a provider hands over as "actions" is untrusted data: this keeps only well-formed ones,
 * with texts cleaned like result names, at most MAX_ACTIONS, without two of the same id.
 *
 * @param {unknown} list
 * @returns {Array<{id: string, label: string, hint?: string, copy?: string, confirmation?: string, group?: string}>}
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
        if (typeof raw.copy === 'string' && raw.copy !== '' && raw.copy.length <= MAX_COPY_CHARS)
            action.copy = raw.copy;
        const confirmation = sanitizeLabel(raw.confirmation);
        if (confirmation !== '')
            action.confirmation = confirmation;
        if (typeof raw.group === 'string' && GROUP_PATTERN.test(raw.group))
            action.group = raw.group;
        clean.push(action);
    }
    return clean;
}

/**
 * The rows of a menu: each action keeps its place in the list, and a separator goes before the first
 * action of each new family, so the menu reads in blocks (open, place, copy).
 *
 * @param {Array<{label: string, hint?: string, group?: string}>} actions
 * @returns {Array<{index: number, label: string, hint?: string, separatorBefore: boolean}>}
 */
export function menuEntries(actions) {
    return actions.map((action, index) => ({
        index,
        label: action.label,
        hint: action.hint,
        separatorBefore: index > 0 && action.group !== actions[index - 1].group,
    }));
}

export class ActionMenu {
    /** @type {{title: string, actions: object[], index: number} | null} */
    #shown = null;

    /** True while a menu is shown. */
    get isOpen() {
        return this.#shown !== null;
    }

    get title() {
        return this.#shown?.title ?? '';
    }

    get actions() {
        return [...(this.#shown?.actions ?? [])];
    }

    get index() {
        return this.#shown?.index ?? -1;
    }

    /** The highlighted action, or null. */
    get selected() {
        return this.#shown?.actions[this.#shown.index] ?? null;
    }

    /** Opens the menu for a result, the first action highlighted. Nothing to show: stays closed. */
    open(title, actions) {
        this.#shown = Array.isArray(actions) && actions.length > 0
            ? {title: String(title ?? ''), actions: [...actions], index: 0}
            : null;
    }

    close() {
        this.#shown = null;
    }

    /** Moves the highlight, wrapping around. */
    move(delta) {
        if (!this.#shown || !Number.isInteger(delta))
            return;
        const count = this.#shown.actions.length;
        this.#shown.index = (((this.#shown.index + delta) % count) + count) % count;
    }

    /** Highlights an action by its position (a click). Out of range: nothing changes. */
    select(index) {
        if (this.#shown && Number.isInteger(index) && index >= 0 && index < this.#shown.actions.length)
            this.#shown.index = index;
    }
}
