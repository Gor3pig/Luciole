// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {fold, mergeRanges, wordStarts} from './text.js';

/**
 * Score of each kind of match, from the best to the worst. A better kind always
 * scores higher than a worse one, whatever the text.
 */
export const TIER = {
    EXACT: 1,
    PREFIX: 0.92,
    WORD_PREFIX: 0.8,
    INITIALS: 0.75,
    SUBSTRING: 0.6,
    FUZZY: 0.5,
};

/** A fuzzy match must be at least this dense (query length / span in the text). */
const MIN_FUZZY_DENSITY = 0.25;

/**
 * @typedef {object} Match
 * @property {number} score - 0..1, higher is better
 * @property {Array<[number, number]>} ranges - [start, end) positions to highlight
 */

function wordPrefix(token, text, starts) {
    for (const start of starts) {
        if (text.startsWith(token, start))
            return {score: TIER.WORD_PREFIX, ranges: [[start, start + token.length]]};
    }
    return null;
}

// "gt" matches "GNOME Terminal": each letter starts consecutive words.
function initials(token, text, starts) {
    if (starts.length < token.length)
        return null;
    for (let first = 0; first + token.length <= starts.length; first++) {
        let ok = true;
        for (let k = 0; k < token.length && ok; k++)
            ok = text[starts[first + k]] === token[k];
        if (ok) {
            const ranges = [];
            for (let k = 0; k < token.length; k++)
                ranges.push([starts[first + k], starts[first + k] + 1]);
            return {score: TIER.INITIALS, ranges};
        }
    }
    return null;
}

function substring(token, text) {
    const index = text.indexOf(token);
    if (index < 0)
        return null;
    // Earlier in the text is slightly better, but never reaches the next tier up.
    const score = TIER.SUBSTRING - 0.1 * (index / text.length);
    return {score, ranges: [[index, index + token.length]]};
}

// "ff" matches "Firefox": letters in order, not necessarily next to each other.
function subsequence(token, text, starts) {
    const positions = [];
    let from = 0;
    for (const unit of token) {
        const at = text.indexOf(unit, from);
        if (at < 0)
            return null;
        positions.push(at);
        from = at + 1;
    }
    const span = positions[positions.length - 1] - positions[0] + 1;
    const density = token.length / span;
    if (density < MIN_FUZZY_DENSITY)
        return null;
    const startsAWord = starts.includes(positions[0]) ? 0.05 : 0;
    const score = 0.25 + 0.2 * density + startsAWord;
    return {score: Math.min(score, TIER.FUZZY), ranges: positions.map(p => [p, p + 1])};
}

function matchSingle(token, text, starts) {
    if (text === token)
        return {score: TIER.EXACT, ranges: [[0, text.length]]};
    if (text.startsWith(token))
        return {score: TIER.PREFIX, ranges: [[0, token.length]]};
    return wordPrefix(token, text, starts) ??
        initials(token, text, starts) ??
        substring(token, text) ??
        subsequence(token, text, starts);
}

/**
 * Builds a matcher for one query. The query is folded once; every text given to
 * match() is folded too, so "CAFE", "café" and "Café" all find each other.
 *
 * @param {string} rawQuery
 */
export function createMatcher(rawQuery) {
    const query = fold(rawQuery).trim().replace(/\s+/g, ' ');
    const tokens = query === '' ? [] : query.split(' ');

    /**
     * @param {string} folded - text already folded (same length as the original)
     * @returns {Match | null}
     */
    function matchFolded(folded) {
        if (tokens.length === 0)
            return null;
        const starts = wordStarts(folded);

        // The whole query, spaces included, as one piece ("gnome te" in "gnome terminal").
        const whole = matchSingle(query, folded, starts);
        if (whole && (tokens.length === 1 || whole.score >= TIER.SUBSTRING))
            return whole;
        if (tokens.length === 1)
            return null;

        // Otherwise every word of the query must match somewhere.
        const parts = [];
        for (const token of tokens) {
            const found = matchSingle(token, folded, starts);
            if (!found)
                return null;
            parts.push(found);
        }
        const mean = parts.reduce((sum, part) => sum + part.score, 0) / parts.length;
        return {
            score: Math.min(mean, TIER.WORD_PREFIX),
            ranges: mergeRanges(parts.flatMap(part => part.ranges)),
        };
    }

    return {
        query,
        tokens,
        isEmpty: tokens.length === 0,
        /** @param {string} text @returns {Match | null} */
        match(text) {
            return matchFolded(fold(text));
        },
        matchFolded,
    };
}
