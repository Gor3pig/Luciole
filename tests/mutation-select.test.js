// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {cacheKey, changedLineRanges, isNew, linesOf, sample, touches} from './mutation/select.js';
import {assert, assertEquals, test} from './harness.js';

test('the changed lines are read from a diff without context', () => {
    const diff = [
        'diff --git a/x b/x', '--- a/x', '+++ b/x',
        '@@ -3 +3 @@', '-a', '+b',
        '@@ -10,2 +10,4 @@', '+c',
        '@@ -20,3 +22,0 @@', '-gone',
        '@@ -1 +1,0 @@',
    ].join('\n');
    assertEquals(changedLineRanges(diff), [[3, 3], [10, 13], [22, 22], [1, 1]]);
    assertEquals(changedLineRanges(''), []);
    assertEquals(changedLineRanges(undefined), []);
});

test('a piece of code is placed by its lines, when it is there exactly once', () => {
    const text = 'one\ntwo\nthree\nfour\n';
    assertEquals(linesOf(text, 'two'), [2, 2]);
    assertEquals(linesOf(text, 'two\nthree'), [2, 3]);
    assertEquals(linesOf(text, 'one'), [1, 1]);
    assertEquals(linesOf(text, 'five'), null);
    assertEquals(linesOf('a a', 'a'), null, 'twice is not a place');
    assertEquals(linesOf(text, ''), null);
    assertEquals(linesOf(undefined, 'a'), null);
});

test('a mutant counts as changed when it comes within a few lines of a change', () => {
    assert(touches([10, 10], [[10, 10]]), 'on it');
    assert(touches([10, 12], [[12, 20]]), 'overlapping');
    assert(touches([5, 5], [[8, 9]]), 'three lines before');
    assert(!touches([4, 4], [[8, 9]]), 'four lines before');
    assert(touches([12, 12], [[8, 9]]), 'three lines after');
    assert(!touches([13, 13], [[8, 9]]), 'four lines after');
    assert(!touches([1, 2], []), 'nothing changed');
    assert(touches([20, 20], [[1, 2], [18, 19]]), 'any of the ranges');
    assert(!touches([5, 5], [[8, 9]], 0), 'no margin');
});

test('a random share is drawn, the same for the same seed, at least one', () => {
    const items = Array.from({length: 50}, (_, n) => n);
    const first = sample(items, 0.1, 42);
    assertEquals(first.length, 5);
    assertEquals(sample(items, 0.1, 42), first, 'the same seed draws the same');
    assert(JSON.stringify(sample(items, 0.1, 43)) !== JSON.stringify(first), 'another seed, another draw');
    assert(first.every(item => items.includes(item)) && new Set(first).size === first.length, 'distinct items of the list');
    assertEquals(sample(items.slice(0, 3), 0.1, 1).length, 1, 'at least one');
    assertEquals(sample(items, 1, 1).length, 50, 'everything');
    assertEquals(sample(items, 0, 1), [], 'no share, nothing');
    assertEquals(sample([], 0.5, 1), []);
    assertEquals(sample(undefined, 0.5, 1), []);
    assertEquals(items.length, 50, 'the list itself is not touched');
});

test('a mutant is new when its earlier specification does not have it exactly', () => {
    const mutant = {file: 'a.js', label: 'x', old: 'a', new: 'b'};
    assert(!isNew(mutant, [{...mutant, label: 'renamed'}]), 'the label does not matter');
    assert(isNew(mutant, [{...mutant, old: 'c'}]), 'another old text');
    assert(isNew(mutant, [{...mutant, new: 'c'}]), 'another new text');
    assert(isNew({...mutant, also: [{old: 'p', new: 'q'}]}, [mutant]), 'more edits');
    assert(isNew({...mutant, command: ['sh', 'x']}, [mutant]), 'another test');
    assert(isNew(mutant, []), 'not there');
    assert(isNew(mutant, null), 'no earlier specification');
});

test('a cached result is found again only for the very same code, mutant, test and programs', () => {
    const mutant = {file: 'a.js', label: 'x', old: 'a', new: 'b'};
    const base = {tree: 't1', mutant, command: ['sh', 'x.sh'], versions: ['shell 51', 'gjs 1.88']};
    const key = cacheKey(base);
    assertEquals(cacheKey({...base}), key, 'the same, the same key');
    assertEquals(cacheKey({...base, mutant: {...mutant, label: 'renamed'}}), key, 'the label does not count');
    const differs = [
        ['another tree', {...base, tree: 't2'}],
        ['another file', {...base, mutant: {...mutant, file: 'b.js'}}],
        ['another old text', {...base, mutant: {...mutant, old: 'c'}}],
        ['another new text', {...base, mutant: {...mutant, new: 'c'}}],
        ['more edits', {...base, mutant: {...mutant, also: [{old: 'p', new: 'q'}]}}],
        ['another test', {...base, command: ['sh', 'y.sh']}],
        ['another part of a test', {...base, command: ['env', 'FILES_PARTS=menu', 'sh', 'x.sh']}],
        ['another shell', {...base, versions: ['shell 50', 'gjs 1.88']}],
        ['another GJS', {...base, versions: ['shell 51', 'gjs 1.86']}],
    ];
    for (const [why, other] of differs)
        assert(cacheKey(other) !== key, why);
});
