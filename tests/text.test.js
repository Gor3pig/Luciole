import {fold, foldChar, isWordChar, mergeRanges, wordStarts} from '../src/core/text.js';
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
