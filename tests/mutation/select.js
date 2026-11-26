// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Which mutants a quick run checks: those whose code was changed (with a margin), those that are new
// in their specification, and a random share of the others, so untouched code is still watched over
// time. Pure functions, used by run.js and tested on their own.

/**
 * The lines a unified diff with no context (git diff -U0) touches in the new file, as [first, last]
 * ranges (1-based). A hunk that only removes lines touches the line where they were.
 *
 * @param {string} diff
 * @returns {Array<[number, number]>}
 */
export function changedLineRanges(diff) {
    const ranges = [];
    for (const line of String(diff).split('\n')) {
        const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (!match)
            continue;
        const start = Number(match[1]);
        const count = match[2] === undefined ? 1 : Number(match[2]);
        ranges.push(count === 0 ? [Math.max(1, start), Math.max(1, start)] : [start, start + count - 1]);
    }
    return ranges;
}

/**
 * The lines [first, last] (1-based) a piece of text occupies in a file, or null when it is not there
 * exactly once.
 */
export function linesOf(text, piece) {
    if (typeof text !== 'string' || typeof piece !== 'string' || piece === '')
        return null;
    const at = text.indexOf(piece);
    if (at < 0 || text.indexOf(piece, at + 1) >= 0)
        return null;
    const first = text.slice(0, at).split('\n').length;
    return [first, first + piece.split('\n').length - 1];
}

/** Whether [first, last] comes within `margin` lines of any of the ranges. */
export function touches([first, last], ranges, margin = 3) {
    return ranges.some(([start, end]) => first <= end + margin && last >= start - margin);
}

/** A small deterministic random generator, so a sample can be drawn again from its seed. */
function generator(seed) {
    let state = (Number(seed) >>> 0) || 1;
    return () => {
        state ^= state << 13;
        state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        return state / 0x100000000;
    };
}

/**
 * A random share of the items (at least one when there are any and the share is above zero), the
 * same for the same seed.
 */
export function sample(items, share, seed) {
    if (!Array.isArray(items) || items.length === 0 || !(share > 0))
        return [];
    const random = generator(seed);
    const count = Math.min(items.length, Math.max(1, Math.ceil(items.length * share)));
    const pool = [...items];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
}

/** Whether a mutant is not in the earlier version of its specification (new, or changed). */
export function isNew(mutant, earlierMutants) {
    if (!Array.isArray(earlierMutants))
        return true;
    return !earlierMutants.some(earlier => earlier.file === mutant.file && earlier.old === mutant.old &&
        earlier.new === mutant.new && JSON.stringify(earlier.also ?? null) === JSON.stringify(mutant.also ?? null) &&
        JSON.stringify(earlier.command ?? null) === JSON.stringify(mutant.command ?? null));
}
