// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {fold, mergeRanges, sanitizeLabel, splitByRanges, wordStarts} from '../../src/core/text.js';
import {FILE_TYPES, parseTypeQuery} from '../../src/core/type-filter.js';
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

test('fuzz: a sanitized label is safe, short, tidy and stable', () => {
    forAll('sanitizeLabel', random => {
        const clean = sanitizeLabel(random.string(ALPHABETS.everything, 400));
        assert(clean.length <= 300, `length ${clean.length}`);
        // eslint-disable-next-line no-control-regex -- control characters are what is looked for
        assert(!/[\u0000-\u001f\u007f-\u009f]/.test(clean), 'a control character survived');
        for (const code of [0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069])
            assert(!clean.includes(String.fromCodePoint(code)), `U+${code.toString(16)} survived`);
        assert(!/ {2}/.test(clean) && clean === clean.trim(), 'untidy spaces');
        assertEquals(sanitizeLabel(clean), clean, 'not stable when applied twice');
    });
});

test('fuzz: whatever follows "/", the type filter gives a known type, known suggestions or nothing', () => {
    const ids = new Set(FILE_TYPES.map(type => type.id));
    forAll('parseTypeQuery', random => {
        const text = `${random.pick(['/', ' /', '', '//'])}${random.string(random.pick([ALPHABETS.ascii, ALPHABETS.everything]), random.int(0, 20))}`;
        const parsed = parseTypeQuery(text);
        if (parsed === null)
            return;
        if (parsed.suggestions) {
            assert(parsed.suggestions.length > 0 && parsed.suggestions.every(id => ids.has(id)), `bad suggestions ${JSON.stringify(parsed)}`);
        } else {
            assert(ids.has(parsed.type), `unknown type ${parsed.type}`);
            assert(typeof parsed.text === 'string' && parsed.text === parsed.text.trim(), `untidy text ${JSON.stringify(parsed.text)}`);
            assert(text.includes(parsed.text), 'the words come from what was typed');
        }
    });
});
