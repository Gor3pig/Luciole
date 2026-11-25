// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {createMatcher, TIER} from '../src/core/matching.js';
import {assert, assertEquals, test} from './harness.js';

const match = (query, text) => createMatcher(query).match(text);
const score = (query, text) => match(query, text)?.score ?? null;

test('an empty or blank query matches nothing', () => {
    assert(createMatcher('').isEmpty && createMatcher('   ').isEmpty, 'isEmpty');
    assertEquals(match('  ', 'Firefox'), null);
});

test('kinds of match are ranked exact > prefix > word prefix > initials > substring > fuzzy', () => {
    const exact = score('terminal', 'Terminal');
    const prefix = score('term', 'Terminal');
    const word = score('term', 'GNOME Terminal');
    const initials = score('gt', 'GNOME Terminal');
    const sub = score('rmin', 'Terminal');
    const fuzzy = score('ff', 'Firefox');
    assertEquals(exact, TIER.EXACT);
    assertEquals(prefix, TIER.PREFIX);
    assertEquals(word, TIER.WORD_PREFIX);
    assertEquals(initials, TIER.INITIALS);
    assert(sub < TIER.SUBSTRING + 1e-9 && sub > TIER.FUZZY, `substring ${sub}`);
    assert(fuzzy <= TIER.FUZZY && fuzzy > 0, `fuzzy ${fuzzy}`);
    assert(exact > prefix && prefix > word && word > initials && initials > sub && sub > fuzzy, 'order');
});

test('accents and case are ignored in both directions', () => {
    assertEquals(score('cafe', 'Café'), TIER.EXACT);
    assertEquals(score('CAFÉ', 'cafe'), TIER.EXACT);
    assertEquals(score('ecole', 'École primaire'), TIER.PREFIX);
});

test('"ff" finds Firefox and "gt" finds GNOME Terminal', () => {
    assert(match('ff', 'Firefox') !== null, 'ff');
    assert(match('gt', 'GNOME Terminal') !== null, 'gt');
});

test('highlight ranges point at the matched characters', () => {
    assertEquals(match('fi', 'Firefox').ranges, [[0, 2]]);
    assertEquals(match('term', 'GNOME Terminal').ranges, [[6, 10]]);
    assertEquals(match('gt', 'GNOME Terminal').ranges, [[0, 1], [6, 7]]);
    assertEquals(match('ff', 'Firefox').ranges, [[0, 1], [4, 5]]);
});

test('ranges stay valid for accented text', () => {
    assertEquals(match('ele', 'Élève').ranges, [[0, 3]]);
});

test('a substring later in the text scores a little lower', () => {
    assert(score('rm', 'xrmab') > score('rm', 'xxxxrm'), 'later is lower');
});

test('letters that are not in the text give no match', () => {
    assertEquals(match('zq', 'Firefox'), null);
    assertEquals(match('xyz', ''), null);
});

test('a fuzzy match spread over a long text is rejected', () => {
    assertEquals(match('ab', `a${'x'.repeat(30)}b`), null);
});

test('several words must all match', () => {
    assert(match('gnome ter', 'GNOME Terminal') !== null, 'prefix of the whole');
    assert(match('term gnome', 'GNOME Terminal') !== null, 'any order');
    assertEquals(match('term zzz', 'GNOME Terminal'), null);
});

test('several words highlight every part', () => {
    assertEquals(match('term gnome', 'GNOME Terminal').ranges, [[0, 5], [6, 10]]);
});

test('extra spaces in the query are ignored', () => {
    assertEquals(score('  term   gnome ', 'GNOME Terminal'), score('term gnome', 'GNOME Terminal'));
});

test('matchFolded gives the same result as match for folded text', () => {
    const matcher = createMatcher('fi');
    assertEquals(matcher.matchFolded('firefox'), matcher.match('Firefox'));
});

test('a fuzzy match that starts a word scores a little higher', () => {
    assert(score('fe', 'fire') > score('fe', 'xfire'), 'word start bonus');
});

test('several words never score above the word-prefix tier', () => {
    assertEquals(score('term gnome', 'GNOME Terminal'), TIER.WORD_PREFIX);
});

test('the query is split into words on any amount of white space', () => {
    assertEquals(createMatcher('  a   b ').tokens, ['a', 'b']);
});
