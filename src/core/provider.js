// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

/**
 * The contract every result source follows. The core only knows this interface:
 * a calculator, a web search or a bridge to GNOME search providers is added as
 * one more class, without touching the core, the ranking or the window.
 *
 * @typedef {object} Result
 * @property {string} id - unique within the provider
 * @property {string} title - shown to the user, and the first thing matched
 * @property {string} [subtitle]
 * @property {unknown} [icon] - a Gio.Icon or an icon name
 * @property {Array<string | {text: string, weight?: number, folded?: string}>} [matchFields]
 *   extra texts to match (keywords...); the title is used when absent
 * @property {number} [providerScore] - 0..1, when the provider already ranks its results
 * @property {string} [frecencyKey] - stable key to remember how often it is used
 * @property {string} [dedupeKey] - same value across providers means the same thing
 * @property {unknown} [data] - opaque, handed back to activate()
 *
 * @typedef {object} SearchOptions
 * @property {import('gi://Gio').Cancellable} cancellable - cancelled when the query changes
 * @property {number} limit - how many results are useful
 * @property {(results: Result[]) => void} emit - hand over results early, in batches
 */

export class Provider {
    /** Stable identifier: used in settings and in frecency keys. */
    get id() {
        throw new Error('Provider.id must be overridden');
    }

    /** Translated name of the section. */
    get name() {
        return this.id;
    }

    /** Lower comes first when sections are ordered. */
    get priority() {
        return 100;
    }

    /**
     * How much this provider's scores count against the others (1 = fully). A
     * provider whose matches are less likely to be what the user wants, such as
     * files next to applications, uses a value below 1.
     */
    get scoreWeight() {
        return 1;
    }

    /** Wait this long (ms) after the last keystroke before searching; 0 for cheap sources. */
    get debounceMs() {
        return 0;
    }

    /** The provider is given up on after this long (ms). It never breaks the others. */
    get timeoutMs() {
        return 500;
    }

    /** How many results are shown at most. */
    get maxResults() {
        return 8;
    }

    /** Called once when the provider is started. Open connections and build indexes here. */
    async init(_context) {}

    /** Release everything. Must be safe to call twice. */
    destroy() {}

    /**
     * Searches asynchronously. It must never block the main loop, and must stop
     * early when options.cancellable is cancelled.
     *
     * @param {string} _query
     * @param {SearchOptions} _options
     * @returns {Promise<Result[]>}
     */
    async search(_query, _options) {
        return [];
    }

    /** Results to show when the query is empty (recent or frequent items). */
    async emptyQueryResults(_options) {
        return [];
    }

    /** Runs the result (opens the application, the file...). */
    async activate(_result, _options) {}

    /** Other things that can be done with a result, e.g. "open the parent folder". */
    secondaryActions(_result) {
        return [];
    }

    async activateAction(_result, _action) {}
}

const REQUIRED_STRINGS = ['id'];
const REQUIRED_FUNCTIONS = ['search', 'activate'];

/** Throws a readable error when something does not honour the contract. */
export function validateProvider(provider) {
    if (!provider || typeof provider !== 'object')
        throw new TypeError('a provider must be an object');
    for (const name of REQUIRED_STRINGS) {
        if (typeof provider[name] !== 'string' || provider[name] === '')
            throw new TypeError(`provider.${name} must be a non-empty string`);
    }
    for (const name of REQUIRED_FUNCTIONS) {
        if (typeof provider[name] !== 'function')
            throw new TypeError(`provider "${provider.id}" must implement ${name}()`);
    }
    for (const name of ['priority', 'scoreWeight', 'debounceMs', 'timeoutMs', 'maxResults']) {
        if (!Number.isFinite(provider[name]))
            throw new TypeError(`provider "${provider.id}": ${name} must be a number`);
    }
}
