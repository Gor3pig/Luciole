// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {fold, foldChar, isWordChar, mergeRanges, splitByRanges, wordStarts} from '../src/core/text.js';
import {assert, assertEquals, test} from './harness.js';

test('fold lower-cases and strips accents', () => {
    assertEquals(fold('Café Élève ÀÇÙ'), 'cafe eleve acu');
});

test('fold keeps the length so positions stay valid', () => {
    for (const text of ['Café', 'ÉCOLE', 'İstanbul', 'naïve', 'Straße', 'ǅ']) {
        assertEquals(fold(text).length, text.length, text);
    }
});

test('foldChar leaves characters without a base letter alone', () => {
    assertEquals(foldChar('-'), '-');
    assertEquals(foldChar('7'), '7');
    assertEquals(foldChar('ß'), 'ß');
});

test('isWordChar tells letters and digits from separators', () => {
    assert(isWordChar('a') && isWordChar('é') && isWordChar('7'), 'letters and digits');
    assert(!isWordChar(' ') && !isWordChar('-') && !isWordChar('.'), 'separators');
});

test('wordStarts finds each word, with any separator', () => {
    assertEquals(wordStarts('gnome terminal'), [0, 6]);
    assertEquals(wordStarts('pare-feu.txt'), [0, 5, 9]);
    assertEquals(wordStarts('  a b'), [2, 4]);
    assertEquals(wordStarts(''), []);
});

test('mergeRanges merges touching and overlapping ranges, and sorts them', () => {
    assertEquals(mergeRanges([[5, 7], [0, 2], [2, 4], [6, 9]]), [[0, 4], [5, 9]]);
    assertEquals(mergeRanges([]), []);
});

test('mergeRanges keeps the widest end when a range is contained in another', () => {
    assertEquals(mergeRanges([[0, 10], [2, 3]]), [[0, 10]]);
});

test('mergeRanges does not modify its input', () => {
    const input = [[3, 4], [0, 1]];
    mergeRanges(input);
    assertEquals(input, [[3, 4], [0, 1]]);
});

test('splitByRanges separates matched parts from the rest', () => {
    assertEquals(splitByRanges('Firefox', [[0, 2]]), [{text: 'Fi', match: true}, {text: 'refox', match: false}]);
    assertEquals(splitByRanges('GNOME Terminal', [[0, 1], [6, 7]]), [
        {text: 'G', match: true}, {text: 'NOME ', match: false},
        {text: 'T', match: true}, {text: 'erminal', match: false},
    ]);
});

test('splitByRanges handles no range, a full match and out-of-order ranges', () => {
    assertEquals(splitByRanges('abc', []), [{text: 'abc', match: false}]);
    assertEquals(splitByRanges('abc', [[0, 3]]), [{text: 'abc', match: true}]);
    assertEquals(splitByRanges('abcdef', [[4, 5], [0, 1]]), [
        {text: 'a', match: true}, {text: 'bcd', match: false}, {text: 'e', match: true}, {text: 'f', match: false},
    ]);
});

test('splitByRanges clamps ranges that go beyond the text and drops empty ones', () => {
    assertEquals(splitByRanges('abc', [[2, 9]]), [{text: 'ab', match: false}, {text: 'c', match: true}]);
    assertEquals(splitByRanges('abc', [[5, 7], [1, 1]]), [{text: 'abc', match: false}]);
    assertEquals(splitByRanges('', [[0, 1]]), []);
});

test('splitByRanges parts always add up to the original text', () => {
    const text = 'Éditeur de texte';
    const joined = splitByRanges(text, [[0, 3], [9, 11]]).map(part => part.text).join('');
    assertEquals(joined, text);
});
