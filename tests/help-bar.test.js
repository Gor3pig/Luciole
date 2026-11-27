// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {helpItems} from '../src/core/help-bar.js';
import {assertEquals, test} from './harness.js';

const echo = text => text;
const said = (item, canPreview = false) => helpItems(item, {canPreview, gettext: echo}).map(({label, key}) => `${label} ${key}`);

test('a file: Open, Preview when it can be previewed, and its actions', () => {
    const file = {providerId: 'files', result: {data: {folder: false}}};
    assertEquals(said(file, true), ['Open Enter', 'Preview Space', 'Actions Ctrl+K']);
    assertEquals(said(file, false), ['Open Enter', 'Actions Ctrl+K']);
});

test('a folder opens in Files', () => {
    assertEquals(said({providerId: 'folders', result: {data: {folder: true}}}), ['Open in Files Enter', 'Actions Ctrl+K']);
});

test('an application opens, and has its actions', () => {
    assertEquals(said({providerId: 'apps', result: {}}), ['Open Enter', 'Actions Ctrl+K']);
});

test('a calculation is copied', () => {
    assertEquals(said({providerId: 'calc', result: {}}), ['Copy Result Enter', 'Actions Ctrl+K']);
});

test('a Settings panel or an action of the system only opens', () => {
    assertEquals(said({providerId: 'system', result: {}}), ['Open Enter']);
});

test('a type of file to choose is chosen with Enter', () => {
    assertEquals(said({providerId: 'files', result: {completesTo: '/pdf '}}, true), ['Choose Enter']);
});

test('nothing chosen, nothing said', () => {
    assertEquals(said(null), []);
    assertEquals(said({providerId: 'files'}), []);
});

test('the words are translated', () => {
    const items = helpItems({providerId: 'apps', result: {}}, {canPreview: false, gettext: text => `[${text}]`});
    assertEquals(items, [{label: '[Open]', key: '[Enter]'}, {label: '[Actions]', key: '[Ctrl+K]'}]);
});
