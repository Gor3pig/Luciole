// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Seeded random data for the fuzz tests. A failure prints its seed, so the exact
// run can be replayed with LUCIOLE_SEED=<seed>.

import GLib from 'gi://GLib';

export const SEED = Number(GLib.getenv('LUCIOLE_SEED') ?? 12345);
export const ITERATIONS = Number(GLib.getenv('LUCIOLE_FUZZ_ITERATIONS') ?? 3000);

/** mulberry32: small, fast, good enough, and identical on every run. */
export function createRandom(seed = SEED) {
    let state = seed >>> 0;
    const next = () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (min, max) => min + Math.floor(next() * (max - min + 1));
    const pick = items => items[int(0, items.length - 1)];
    const chance = probability => next() < probability;
    const string = (alphabet, maxLength) => {
        const chars = Array.from(alphabet);
        let out = '';
        for (let i = int(0, maxLength); i > 0; i--)
            out += pick(chars);
        return out;
    };
    return {next, int, pick, chance, string};
}

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const ACCENTED = 'éèêëàâäîïôöùûüçñÉÈÀÇÑœæßİıŁł';
const SEPARATORS = ' -_./\\:;,';
// Things that have broken query parsers, markup renderers and file managers.
const HOSTILE = '"\'*()<>{}[]^~|&%$#@!?=+`\\\n\t\r\0;';
const COMBINING = '̧́̈\u200d️';
const SPOOFING = '\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069\u200e\u200f';
const WIDE = '日本語中文한국어🙂🦊𝒳𝔸\u{1F468}\u200d\u{1F469}';
const LONE_SURROGATES = '𐀀􏿿';

export const ALPHABETS = {
    ascii: LOWER + LOWER.toUpperCase() + DIGITS + SEPARATORS,
    words: LOWER + LOWER + LOWER + ' ',
    hostile: LOWER + DIGITS + SEPARATORS + HOSTILE,
    unicode: LOWER + ACCENTED + SEPARATORS + COMBINING + SPOOFING + WIDE + LONE_SURROGATES,
    everything: LOWER + DIGITS + ACCENTED + SEPARATORS + HOSTILE + COMBINING + SPOOFING + WIDE + LONE_SURROGATES,
};

/** Runs `body(random, index)` many times; a failure names the seed and the iteration. */
export function forAll(name, body, iterations = ITERATIONS) {
    const random = createRandom(SEED);
    for (let i = 0; i < iterations; i++) {
        try {
            body(random, i);
        } catch (error) {
            throw new Error(`${name}: seed ${SEED}, iteration ${i}: ${error.message}`, {cause: error});
        }
    }
}
