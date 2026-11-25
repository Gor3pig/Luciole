// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {fold} from './text.js';

export const SCORING = {
    /** Below this text score a result is dropped. */
    MIN_TEXT: 0.15,
    /** Most a result can gain from frecency. */
    FRECENCY_MAX: 0.25,
    /** Frecency only counts for results that already match well enough. */
    FRECENCY_MIN_TEXT: 0.3,
};

function normalizeFields(result) {
    const fields = result.matchFields?.length ? result.matchFields : [result.title];
    return fields.map(field => typeof field === 'string' ? {text: field, weight: 1} : {weight: 1, ...field});
}

/**
 * @typedef {object} Scored
 * @property {number} text - how well the text matches, 0..1
 * @property {number} bonus - what frecency added
 * @property {number} final - text + bonus
 * @property {Array<[number, number]>} ranges - parts of the title to highlight
 */

/**
 * Scores one result against the query.
 *
 * The best-matching of the result's `matchFields` counts (the title, shown to the
 * user, and keywords and the like, weighted).
 * A result that comes with its own `providerScore` (a file found by full-text
 * search) mixes it with the name match. Frecency lifts good matches only: a
 * result used a lot but barely matching never beats a good match.
 *
 * @returns {Scored | null} null when the result does not match enough
 */
export function scoreResult(result, matcher, frecency, now) {
    if (matcher.isEmpty)
        return null;

    let best = null;
    normalizeFields(result).forEach(field => {
        const found = matcher.matchFolded(field.folded ?? fold(field.text));
        if (!found)
            return;
        const score = found.score * field.weight;
        if (!best || score > best.score)
            best = {score, ranges: found.ranges, text: field.text};
    });

    let text;
    if (typeof result.providerScore === 'number') {
        const provided = Math.min(1, Math.max(0, result.providerScore));
        text = 0.5 * provided + 0.5 * (best ? best.score : 0);
    } else if (best) {
        text = best.score;
    } else {
        return null;
    }
    if (text < SCORING.MIN_TEXT)
        return null;

    let bonus = 0;
    if (text >= SCORING.FRECENCY_MIN_TEXT && frecency && result.frecencyKey)
        bonus = SCORING.FRECENCY_MAX * frecency.score(result.frecencyKey, now);

    return {
        text,
        bonus,
        final: text + bonus,
        // Ranges are positions in the field that matched: they only make sense for
        // the title, so they are kept only when that field IS the title.
        ranges: best && best.text === result.title ? best.ranges : [],
    };
}

/** Score of a result shown for an empty query: only frecency ranks it. */
export function scoreForEmptyQuery(result, frecency, now) {
    const f = frecency && result.frecencyKey ? frecency.score(result.frecencyKey, now) : 0;
    return {text: 0, bonus: f, final: f, ranges: []};
}
