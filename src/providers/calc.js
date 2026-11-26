// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {evaluateQuery} from '../core/calc.js';
import {Provider} from '../core/provider.js';

/** The decimal mark of the session's language, "." when it cannot be told. */
export function sessionDecimalMark() {
    try {
        return new Intl.NumberFormat().formatToParts(1.5).find(part => part.type === 'decimal')?.value ?? '.';
    } catch {
        return '.';
    }
}

/**
 * Calculations and unit conversions typed in the search field, worked out here, offline. The
 * result is shown first; Enter copies it. Nothing is evaluated: see core/calc.js.
 */
export class CalcProvider extends Provider {
    #copyText;
    #decimal;
    #gettext = null;
    #log = null;

    /**
     * @param {object} options
     * @param {(text: string) => void} options.copyText - puts a text on the clipboard
     * @param {string} [options.decimal] - the decimal mark to show results with (default: the session's)
     */
    constructor({copyText, decimal = sessionDecimalMark()}) {
        super();
        this.#copyText = copyText;
        this.#decimal = decimal === ',' ? ',' : '.';
    }

    get id() {
        return 'calc';
    }

    get name() {
        const _ = this.#gettext ?? (text => text);
        return _('Calculator');
    }

    // Before applications and files, and never moved up to "top hit": it keeps its own section.
    get priority() {
        return 5;
    }

    get topHitEligible() {
        return false;
    }

    get maxResults() {
        return 1;
    }

    get timeoutMs() {
        return 100;
    }

    async init({gettext, log}) {
        this.#gettext = gettext;
        this.#log = log ?? null;
    }

    async search(query) {
        const outcome = evaluateQuery(query, {decimal: this.#decimal});
        if (!outcome)
            return [];
        const _ = this.#gettext;
        return [{
            id: outcome.text,
            title: outcome.result,
            subtitle: `${outcome.text} · ${_('Enter to copy')}`,
            icon: 'accessories-calculator-symbolic',
            // The typed text matches itself: the result always scores as a full match.
            matchFields: [outcome.text],
            providerScore: 1,
            data: {copy: outcome.result, full: outcome.full},
            // Enter copies, so the window says so for a moment instead of closing at once.
            activationConfirmation: _('Result copied'),
        }];
    }

    async activate(result) {
        this.#copyText(result.data.copy);
        this.#log?.debug('copied the answer');
    }

    /** The menu: copying the result (what Enter does) or the whole calculation. */
    async actions(result) {
        const _ = this.#gettext;
        return [
            {id: 'open', label: _('Copy Result'), hint: _('Enter')},
            {id: 'copy-full', label: _('Copy Full Calculation'), copy: result.data.full, confirmation: _('Calculation copied')},
        ];
    }
}
