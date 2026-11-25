// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Text normalisation shared by matching and highlighting.
//
// Folding keeps the string length: every UTF-16 unit maps to exactly one unit.
// That way a position found in the folded text is the same position in the
// original text, which is what highlighting needs.

/** Folds one UTF-16 unit: lower case, accent removed ("É" becomes "e"). */
export function foldChar(unit) {
    // Some characters lower-case or decompose to several units ("İ", "é"):
    // keeping the first unit of the result is what keeps the length unchanged.
    return unit.toLowerCase().normalize('NFD')[0];
}

/** Lower-cases and strips accents without changing the length. */
export function fold(text) {
    let out = '';
    for (let i = 0; i < text.length; i++)
        out += foldChar(text[i]);
    return out;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** True when the unit is part of a word (letter or digit). */
export function isWordChar(unit) {
    return WORD_CHAR.test(unit);
}

/** Positions where a word starts in a folded text. */
export function wordStarts(folded) {
    const starts = [];
    for (let i = 0; i < folded.length; i++) {
        if (isWordChar(folded[i]) && (i === 0 || !isWordChar(folded[i - 1])))
            starts.push(i);
    }
    return starts;
}

/**
 * Sorts [start, end) ranges and merges the ones that touch or overlap.
 *
 * @param {Array<[number, number]>} ranges
 * @returns {Array<[number, number]>}
 */
export function mergeRanges(ranges) {
    const sorted = ranges.map(r => [r[0], r[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    for (const range of sorted) {
        const last = merged[merged.length - 1];
        if (last && range[0] <= last[1])
            last[1] = Math.max(last[1], range[1]);
        else
            merged.push(range);
    }
    return merged;
}

/**
 * Cuts a text into the parts to show: matched ranges and the text around them.
 *
 * @param {string} text
 * @param {Array<[number, number]>} ranges - [start, end) positions, any order
 * @returns {Array<{text: string, match: boolean}>}
 */
export function splitByRanges(text, ranges) {
    const parts = [];
    let at = 0;
    for (const [start, end] of mergeRanges(ranges)) {
        const from = Math.max(at, Math.min(start, text.length));
        const to = Math.min(end, text.length);
        if (to <= from)
            continue;
        if (from > at)
            parts.push({text: text.slice(at, from), match: false});
        parts.push({text: text.slice(from, to), match: true});
        at = to;
    }
    if (at < text.length)
        parts.push({text: text.slice(at), match: false});
    return parts;
}
