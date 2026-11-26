// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// The searches that led to opening a result, newest first, so the up arrow can bring one back.
//
// Pure data, like Frecency: reading and writing the file is done by the caller, with
// serialize() and QueryHistory.from(). A search is remembered only once it was useful (the
// caller records it when a result is opened), never while it is being typed.

import {sanitizeLabel} from './text.js';
import {FILE_TYPES, typePrefix} from './type-filter.js';

export const MAX_QUERIES = 20;
// The search field takes at most 256 characters (see the launcher), after a type of file
// ("/documents ") when one is chosen; a longer text is not a search the user typed, so it is not kept.
export const MAX_QUERY_CHARS = 256 + Math.max(...FILE_TYPES.map(type => typePrefix(type.id).length));

// One text in one form: no control or bidirectional characters, single spaces, trimmed.
function normalize(text) {
    if (typeof text !== 'string' || text.length > MAX_QUERY_CHARS)
        return '';
    return sanitizeLabel(text);
}

const sameQuery = (a, b) => a.toLowerCase() === b.toLowerCase();

export class QueryHistory {
    /** @type {string[]} newest first */
    #entries = [];
    #dirty = false;

    /** Rebuilds from the output of serialize(); ignores anything malformed. */
    static from(data) {
        const history = new QueryHistory();
        const list = data && typeof data === 'object' && Array.isArray(data.queries) ? data.queries : [];
        for (const raw of list) {
            const text = normalize(raw);
            if (text !== '' && !history.#entries.some(entry => sameQuery(entry, text)))
                history.#entries.push(text);
            if (history.#entries.length >= MAX_QUERIES)
                break;
        }
        return history;
    }

    /** The remembered searches, newest first. A copy: callers cannot change the history. */
    get entries() {
        return [...this.#entries];
    }

    get size() {
        return this.#entries.length;
    }

    get dirty() {
        return this.#dirty;
    }

    markSaved() {
        this.#dirty = false;
    }

    /**
     * Remembers a search that led to a result being opened. It goes first; the same search
     * typed in another case or with other spacing is not kept twice; the oldest ones fall off.
     */
    record(query) {
        const text = normalize(query);
        if (text === '')
            return;
        if (this.#entries[0] === text)
            return;
        this.#entries = [text, ...this.#entries.filter(entry => !sameQuery(entry, text))].slice(0, MAX_QUERIES);
        this.#dirty = true;
    }

    clear() {
        if (this.#entries.length > 0)
            this.#dirty = true;
        this.#entries = [];
    }

    serialize() {
        return {version: 1, queries: [...this.#entries]};
    }
}

/**
 * Where the user is while going back through the searches with the arrow keys. It holds no
 * entries itself (they are passed in at each step, so a history cleared or changed in the
 * meantime can never leave it pointing outside the list).
 */
export class HistoryCursor {
    #index = -1;

    /** True while one of the remembered searches is being shown. */
    get active() {
        return this.#index >= 0;
    }

    /** Back to the field the user is typing in. */
    reset() {
        this.#index = -1;
    }

    /** Goes one search further back. Returns its text, or null when there is none. */
    older(entries) {
        if (entries.length === 0) {
            this.#index = -1;
            return null;
        }
        this.#index = Math.min(this.#index + 1, entries.length - 1);
        return entries[this.#index];
    }

    /**
     * Goes one search forward. Returns its text; '' once past the newest one (the cursor is then
     * inactive again); null when not going back through the searches at all.
     */
    newer(entries) {
        if (this.#index < 0)
            return null;
        this.#index = Math.min(this.#index, entries.length) - 1;
        return this.#index >= 0 ? entries[this.#index] : '';
    }

    /** {position, total} (position counts from 1) while active, else null. */
    where(entries) {
        if (this.#index < 0 || entries.length === 0)
            return null;
        return {position: Math.min(this.#index, entries.length - 1) + 1, total: entries.length};
    }
}
