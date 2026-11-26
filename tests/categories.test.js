// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {categoriesOf, categoryForDigit, digitOfKey, effectiveFilter} from '../src/core/categories.js';
import {assertEquals, test} from './harness.js';

const apps = {id: 'apps', name: 'Applications'};
const files = {id: 'files', name: 'Files'};

test('two or more sources give one category each, in order', () => {
    assertEquals(categoriesOf([apps, files]), [apps, files]);
    assertEquals(categoriesOf([files, apps, {id: 'web', name: 'Web'}]).map(c => c.id), ['files', 'apps', 'web']);
});

test('with fewer than two sources there is nothing to choose between', () => {
    assertEquals(categoriesOf([]), []);
    assertEquals(categoriesOf([apps]), []);
});

test('sources that are not usable are left out, and so does a duplicate', () => {
    assertEquals(categoriesOf([apps, null, {name: 'x'}, {id: ''}, {id: 5}, files]).map(c => c.id), ['apps', 'files']);
    assertEquals(categoriesOf([apps, apps]), [], 'one source twice is still one source');
    assertEquals(categoriesOf(undefined), []);
    assertEquals(categoriesOf('apps'), []);
});

test('a source without a name is shown under its identifier', () => {
    assertEquals(categoriesOf([{id: 'apps'}, {id: 'files', name: ''}]), [{id: 'apps', name: 'apps'}, {id: 'files', name: 'files'}]);
});

test('0 means everything, 1 to 9 the n-th category, anything else nothing', () => {
    const categories = [apps, files];
    assertEquals(categoryForDigit(0, categories), null);
    assertEquals(categoryForDigit(1, categories), 'apps');
    assertEquals(categoryForDigit(2, categories), 'files');
    assertEquals(categoryForDigit(3, categories), undefined);
    assertEquals(categoryForDigit(9, categories), undefined);
    for (const odd of [-1, 10, 1.5, NaN, '1', null, undefined])
        assertEquals(categoryForDigit(odd, categories), undefined, String(odd));
});

test('without categories no digit does anything, not even 0', () => {
    assertEquals(categoryForDigit(0, []), undefined);
    assertEquals(categoryForDigit(1, []), undefined);
    assertEquals(categoryForDigit(1, undefined), undefined);
});

test('a source that is gone falls back to everything', () => {
    assertEquals(effectiveFilter('files', [apps, files]), 'files');
    assertEquals(effectiveFilter('files', [apps]), null);
    assertEquals(effectiveFilter(null, [apps, files]), null);
    for (const odd of [undefined, 5, {}, ''])
        assertEquals(effectiveFilter(odd, [apps, files]), null, String(odd));
    assertEquals(effectiveFilter('apps', undefined), null);
});

test('the digit row is read by position, so a French keyboard works', () => {
    // XKB key codes 10..18 are the keys 1..9, 19 is 0, whatever they type.
    for (let n = 1; n <= 9; n++)
        assertEquals(digitOfKey({keyval: 0x26, keycode: 9 + n}), n, `key ${n}`);
    assertEquals(digitOfKey({keyval: 0xe0, keycode: 19}), 0);
});

test('the keypad is read by its symbol, and other keys are not digits', () => {
    assertEquals(digitOfKey({keyval: 0xffb0 + 2, keycode: 90}), 2);
    assertEquals(digitOfKey({keyval: 0xffb0, keycode: 90}), 0);
    assertEquals(digitOfKey({keyval: 0x31, keycode: 0}), 1, 'a digit symbol with no usable position');
    for (const key of [{keyval: 0x61, keycode: 38}, {keyval: 0xffbf, keycode: 91}, {keyval: 0x3a, keycode: 20}, {keyval: undefined, keycode: undefined}])
        assertEquals(digitOfKey(key), null, JSON.stringify(key));
});

test('with many sources, digits still only go from 0 to 9', () => {
    const many = Array.from({length: 12}, (_, n) => ({id: `s${n}`}));
    assertEquals(categoryForDigit(9, many), 's8');
    assertEquals(categoryForDigit(10, many), undefined);
    assertEquals(categoryForDigit(11, many), undefined);
});
