// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {ActionMenu, cleanActions, MAX_ACTIONS, MAX_COPY_CHARS, menuEntries} from '../src/core/action-menu.js';
import {assert, assertEquals, test} from './harness.js';

const RLO = String.fromCodePoint(0x202e);
const open = {id: 'open', label: 'Open'};
const folder = {id: 'open-folder', label: 'Show in Folder', hint: 'Ctrl+Enter'};

test('well-formed actions are kept as they are, with the optional parts they carry', () => {
    assertEquals(cleanActions([
        open,
        {id: 'copy-path', label: 'Copy Path', copy: '/home/a/b.txt', confirmation: 'Path copied'},
        {id: 'open-with', label: 'Open With', hint: '>'},
    ]), [
        {id: 'open', label: 'Open'},
        {id: 'copy-path', label: 'Copy Path', copy: '/home/a/b.txt', confirmation: 'Path copied'},
        {id: 'open-with', label: 'Open With', hint: '>'},
    ]);
});

test('anything that is not a list of actions gives no action', () => {
    for (const odd of [undefined, null, 5, 'open', {}, {id: 'open', label: 'Open'}])
        assertEquals(cleanActions(odd), [], JSON.stringify(odd));
});

test('malformed actions are dropped, the good ones around them stay', () => {
    const list = [null, 5, 'x', {}, {id: 3, label: 'x'}, {id: '', label: 'x'}, {id: 'a'}, {id: 'b', label: '   '}, open, {id: 'x'.repeat(201), label: 'Long'}];
    assertEquals(cleanActions(list), [open]);
});

test('two actions with the same id keep the first one', () => {
    assertEquals(cleanActions([open, {id: 'open', label: 'Another'}]), [open]);
});

test('texts are cleaned like result names', () => {
    const [action] = cleanActions([{id: 'a', label: `report${RLO}fdp.exe\nsecond`, hint: 'Ctrl\n+K', confirmation: `ok${RLO}`}]);
    for (const text of [action.label, action.hint, action.confirmation]) {
        assert(!text.includes(RLO) && !text.includes('\n'), `kept: ${JSON.stringify(text)}`);
    }
});

test('what is put on the clipboard is a non-empty text of reasonable size, and only that', () => {
    const copies = cleanActions([
        {id: 'a', label: 'A', copy: ''},
        {id: 'b', label: 'B', copy: 5},
        {id: 'c', label: 'C', copy: 'x'.repeat(MAX_COPY_CHARS + 1)},
        {id: 'd', label: 'D', copy: 'x'.repeat(MAX_COPY_CHARS)},
    ]);
    assertEquals(copies.map(action => 'copy' in action), [false, false, false, true]);
});

test('what a source adds besides the known parts is dropped', () => {
    const [action] = cleanActions([{id: 'a', label: 'A', submenu: true, run: 'rm -rf /'}]);
    assertEquals(action, {id: 'a', label: 'A'});
});

test('the family of an action is kept when it is a short lowercase word, dropped otherwise', () => {
    const actions = cleanActions([
        {id: 'a', label: 'A', group: 'open'},
        {id: 'b', label: 'B', group: 'place-2'},
        {id: 'c', label: 'C', group: 'Copy'},
        {id: 'd', label: 'D', group: ''},
        {id: 'e', label: 'E', group: 5},
        {id: 'f', label: 'F', group: `copy${RLO}`},
        {id: 'g', label: 'G', group: 'x'.repeat(33)},
        {id: 'h', label: 'H', group: 'copy-files'},
    ]);
    assertEquals(actions.map(action => action.group ?? null), ['open', null, null, null, null, null, null, 'copy-files']);
});

test('a separator goes before the first action of each new family, never at the top', () => {
    const entries = menuEntries([
        {label: 'Open', hint: 'Enter', group: 'open'},
        {label: 'Open With…', group: 'open'},
        {label: 'Show in Folder', hint: 'Ctrl+Enter', group: 'place'},
        {label: 'Copy File', group: 'copy'},
        {label: 'Copy Name', group: 'copy'},
    ]);
    assertEquals(entries.map(entry => entry.separatorBefore), [false, false, true, true, false]);
    assertEquals(entries.map(entry => entry.index), [0, 1, 2, 3, 4], 'each entry keeps its place in the list');
    assertEquals([entries[0].label, entries[0].hint], ['Open', 'Enter']);
    assertEquals(menuEntries([{label: 'Copy Result', group: 'copy'}]).map(entry => entry.separatorBefore), [false]);
});

test('actions without a family, like the calculator\'s, read as one block', () => {
    const entries = menuEntries([{label: 'Copy Result'}, {label: 'Copy Full Calculation'}]);
    assertEquals(entries.map(entry => entry.separatorBefore), [false, false]);
    assertEquals(menuEntries([]), []);
});

test('only so many actions are kept', () => {
    const many = Array.from({length: MAX_ACTIONS + 10}, (_, n) => ({id: `a${n}`, label: `Action ${n}`}));
    assertEquals(cleanActions(many).length, MAX_ACTIONS);
});

test('the menu opens on its first action', () => {
    const menu = new ActionMenu();
    assert(!menu.isOpen, 'closed to begin with');
    menu.open('Quokka.odt', [open, folder]);
    assert(menu.isOpen, 'open');
    assertEquals(menu.title, 'Quokka.odt');
    assertEquals(menu.selected, open);
    assertEquals(menu.index, 0);
});

test('a menu with nothing in it stays closed', () => {
    const menu = new ActionMenu();
    for (const odd of [[], undefined, null, 'x']) {
        menu.open('x', odd);
        assert(!menu.isOpen, `no action, no menu (${JSON.stringify(odd)})`);
    }
    assertEquals(menu.selected, null);
    assertEquals(menu.index, -1);
});

test('the highlight wraps around in both directions', () => {
    const menu = new ActionMenu();
    menu.open('x', [open, folder, {id: 'c', label: 'C'}]);
    menu.move(1);
    assertEquals(menu.selected, folder);
    menu.move(1);
    menu.move(1);
    assertEquals(menu.selected, open, 'past the last, back to the first');
    menu.move(-1);
    assertEquals(menu.selected.id, 'c', 'before the first, the last');
    menu.move(-4);
    assertEquals(menu.selected.id, 'open-folder', 'a long step still wraps (2 - 4 = -2, which is the second of three)');
});

test('moving with something that is not a whole number does nothing', () => {
    const menu = new ActionMenu();
    menu.open('x', [open, folder]);
    for (const odd of [NaN, 1.5, '1', null, undefined, Infinity])
        menu.move(odd);
    assertEquals(menu.index, 0);
});

test('selecting by position is for a click, and ignores positions that do not exist', () => {
    const menu = new ActionMenu();
    menu.open('x', [open, folder]);
    menu.select(1);
    assertEquals(menu.selected, folder);
    for (const odd of [-1, 2, 1.5, '0', NaN, undefined])
        menu.select(odd);
    assertEquals(menu.selected, folder, 'unchanged');
});

test('actions is a copy, and close forgets the menu', () => {
    const menu = new ActionMenu();
    menu.open('x', [open, folder]);
    menu.actions.push({id: 'intruder', label: 'X'});
    assertEquals(menu.actions.length, 2);
    menu.close();
    assert(!menu.isOpen && menu.selected === null && menu.title === '', 'closed');
});

test('moving or selecting on a closed menu is harmless', () => {
    const menu = new ActionMenu();
    menu.move(1);
    menu.select(0);
    assert(!menu.isOpen, 'nothing happened');
});
