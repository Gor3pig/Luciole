// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {nextSelection} from '../src/core/merge.js';
import {ACTION_PREFIX, actionResults, DESTRUCTIVE_ACTIONS, KNOWN_ACTIONS, PANEL_PREFIX, panelResults} from '../src/core/system-items.js';
import {sanitizeLabel} from '../src/core/text.js';
import {assert, assertEquals, test} from './harness.js';

const echo = text => text;

test('the actions the shell offers become results with its own names', () => {
    const results = actionResults([{id: 'lock-screen', name: 'Verrouiller l’écran', iconName: 'system-lock-screen-symbolic'}], echo);
    assertEquals(results.length, 1);
    assertEquals(results[0].id, `${ACTION_PREFIX}lock-screen`);
    assertEquals(results[0].title, 'Verrouiller l’écran');
    assertEquals(results[0].icon, 'system-lock-screen-symbolic');
    assertEquals(results[0].data, {kind: 'action', action: 'lock-screen'});
    assertEquals(results[0].closeBeforeActivate, true);
    assert(results[0].providerScore > 0.5, 'the shell chose it by its keywords: it must not be dropped for its title');
});

test('actions that end the session are marked to be chosen by hand only; the others are not', () => {
    const all = actionResults([...KNOWN_ACTIONS].map(id => ({id, name: id})), echo);
    for (const result of all) {
        const destructive = DESTRUCTIVE_ACTIONS.has(result.data.action);
        assertEquals(result.explicitSelectionOnly === true, destructive, result.data.action);
    }
    assertEquals([...DESTRUCTIVE_ACTIONS].sort(), ['logout', 'power-off', 'restart', 'suspend', 'switch-user']);
    assert(!DESTRUCTIVE_ACTIONS.has('lock-screen') && !DESTRUCTIVE_ACTIONS.has('open-screenshot-ui'), 'locking and screenshots are not drastic');
});

test('the actions the shell confirms say so', () => {
    const results = actionResults([{id: 'power-off', name: 'Power Off'}, {id: 'lock-screen', name: 'Lock'}, {id: 'suspend', name: 'Suspend'}], text => `[${text}]`);
    assertEquals(results[0].subtitle, '[System action] · [asks for confirmation]');
    assertEquals(results[1].subtitle, '[System action]');
    assertEquals(results[2].subtitle, '[System action]', 'suspending has no dialog');
});

test('only the shell\'s own action identifiers become results, and only with a name', () => {
    const results = actionResults([
        {id: 'format-disk', name: 'Format'}, {id: 'lock-screen'}, {id: 'logout', name: ''}, {id: 'suspend', name: 5}, null, undefined, 'lock-screen',
        {id: 'lock-screen', name: 'Lock'},
    ], echo);
    assertEquals(results.map(result => result.data.action), ['lock-screen']);
    assertEquals(actionResults(undefined, echo), []);
    assertEquals(actionResults('lock-screen', echo), []);
});

test('the panels of Settings become results matched on their name and, less, their keywords', () => {
    const [result] = panelResults([{id: 'gnome-wifi-panel.desktop', name: 'Wi-Fi', keywords: ['Réseau', 'Sans fil'], icon: 'network-wireless'}], text => `[${text}]`);
    assertEquals(result.id, `${PANEL_PREFIX}gnome-wifi-panel.desktop`);
    assertEquals(result.title, 'Wi-Fi');
    assertEquals(result.subtitle, '[Settings]');
    assertEquals(result.matchFields, ['Wi-Fi', {text: 'Réseau', weight: 0.7}, {text: 'Sans fil', weight: 0.7}]);
    assertEquals(result.data, {kind: 'panel', panel: 'gnome-wifi-panel.desktop'});
    assertEquals(result.closeBeforeActivate, true);
    assert(!('explicitSelectionOnly' in result) && !('providerScore' in result), 'a panel is an ordinary result');
});

test('only real panel files with a name become results', () => {
    const results = panelResults([
        {id: 'firefox.desktop', name: 'Firefox'}, {id: 'gnome-wifi-panel.desktop'}, {id: 'gnome-x-panel.desktop', name: ''},
        {id: 'gnome-../evil-panel.desktop', name: 'x'}, {id: 'gnome-a b-panel.desktop', name: 'x'}, null, 7,
        {id: 'gnome-sound-panel.desktop', name: 'Son', keywords: [3, '', null, 'Volume']},
    ], echo);
    assertEquals(results.map(result => result.title), ['Son']);
    assertEquals(results[0].matchFields, ['Son', {text: 'Volume', weight: 0.7}]);
    assertEquals(panelResults(undefined, echo), []);
});

test('a soft hyphen in a name is dropped, so the name can be found', () => {
    const softHyphen = String.fromCodePoint(0x00ad);
    assertEquals(sanitizeLabel(`Sou${softHyphen}ris et pav${softHyphen}é`), 'Souris et pavé');
    assertEquals(panelResults([{id: 'gnome-mouse-panel.desktop', name: 'Souris'}], echo)[0].title, 'Souris');
});

const item = (key, extra = {}) => ({key, result: {title: key, ...extra}});

test('the first result is chosen for the user, unless it must be chosen by hand', () => {
    const items = [item('a', {explicitSelectionOnly: true}), item('b'), item('c')];
    assertEquals(nextSelection(null, items, false), 'b');
    assertEquals(nextSelection(null, [item('a'), item('b')], false), 'a');
});

test('when everything must be chosen by hand, nothing is chosen', () => {
    assertEquals(nextSelection(null, [item('a', {explicitSelectionOnly: true})], false), null);
    assertEquals(nextSelection('a', [item('a', {explicitSelectionOnly: true})], false), null, 'not even what was chosen before, if the user has not moved');
});

test('once the user has moved the choice, it stays where they put it, even on such a result', () => {
    const items = [item('a'), item('b', {explicitSelectionOnly: true})];
    assertEquals(nextSelection('b', items, true), 'b');
    assertEquals(nextSelection('gone', items, true), 'a', 'a result that went away: back to the automatic choice');
});

test('only a real true makes a result hand-chosen', () => {
    for (const odd of [false, undefined, null, 1, 'true', {}])
        assertEquals(nextSelection(null, [item('a', {explicitSelectionOnly: odd})], false), 'a', String(odd));
});

test('no results, no choice', () => {
    assertEquals(nextSelection(null, [], false), null);
    assertEquals(nextSelection('a', [], true), null);
});
