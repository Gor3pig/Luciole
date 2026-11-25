// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {fold, mergeRanges, splitByRanges, wordStarts} from '../../src/core/text.js';
import {assert, assertEquals, test} from '../harness.js';
import {ALPHABETS, forAll} from './random.js';

test('fuzz: fold never changes the length and is idempotent', () => {
    forAll('fold', random => {
        const text = random.string(ALPHABETS.everything, 40);
        const folded = fold(text);
        assertEquals(folded.length, text.length, JSON.stringify(text));
        assertEquals(fold(folded), folded, 'idempotent');
    });
});

test('fuzz: wordStarts are valid, increasing positions', () => {
    forAll('wordStarts', random => {
        const folded = fold(random.string(ALPHABETS.everything, 40));
        const starts = wordStarts(folded);
        for (let i = 0; i < starts.length; i++) {
            assert(starts[i] >= 0 && starts[i] < folded.length, `position ${starts[i]} out of range`);
            if (i > 0)
                assert(starts[i] > starts[i - 1], 'not increasing');
        }
    });
});

test('fuzz: mergeRanges gives sorted, separate ranges that cover the same units', () => {
    forAll('mergeRanges', random => {
        const ranges = [];
        for (let n = random.int(0, 8); n > 0; n--) {
            const start = random.int(0, 30);
            ranges.push([start, start + random.int(0, 10)]);
        }
        const merged = mergeRanges(ranges);
        for (let i = 0; i < merged.length; i++) {
            assert(merged[i][0] <= merged[i][1], 'inverted range');
            if (i > 0)
                assert(merged[i][0] > merged[i - 1][1], 'ranges touch or overlap');
        }
        const covered = list => {
            const units = new Set();
            for (const [a, b] of list) {
                for (let u = a; u < b; u++)
                    units.add(u);
            }
            return [...units].sort((x, y) => x - y).join();
        };
        assertEquals(covered(merged), covered(ranges), 'coverage changed');
    });
});

test('fuzz: splitByRanges always rebuilds the text, even with absurd ranges', () => {
    forAll('splitByRanges', random => {
        const text = random.string(ALPHABETS.everything, 30);
        const ranges = [];
        for (let n = random.int(0, 6); n > 0; n--)
            ranges.push([random.int(-5, 40), random.int(-5, 45)]);
        const parts = splitByRanges(text, ranges);
        assertEquals(parts.map(part => part.text).join(''), text, `ranges ${JSON.stringify(ranges)}`);
        for (const part of parts)
            assert(part.text.length > 0, 'empty part');
    });
});
