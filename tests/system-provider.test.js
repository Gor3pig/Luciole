// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';

import {createMatcher} from '../src/core/matching.js';
import {mergeResults} from '../src/core/merge.js';
import {validateProvider} from '../src/core/provider.js';
import {scoreResult} from '../src/core/scoring.js';
import {SystemProvider} from '../src/providers/system.js';
import {recordingLog} from './fakes/provider.js';
import {assert, assertEquals, test} from './harness.js';

// A stand-in for the shell's action list: names and keywords like the real one.
function fakeActions() {
    const names = {'lock-screen': 'Verrouiller l’écran', 'power-off': 'Éteindre…', restart: 'Redémarrer…', suspend: 'Mettre en veille'};
    const keywords = {'lock-screen': ['verrouiller', 'ecran', 'lock'], 'power-off': ['eteindre', 'power', 'off'], restart: ['redemarrer', 'reboot'], suspend: ['veille', 'suspend']};
    const activated = [];
    return {
        activated,
        getMatchingActions: terms => Object.keys(names).filter(id => terms.every(term => keywords[id].some(keyword => keyword.startsWith(term)))),
        getName: id => names[id],
        getIconName: id => `${id}-symbolic`,
        activateAction: id => activated.push(id),
    };
}

function panel(id, name, keywords = []) {
    const launched = [];
    return {id, name, keywords, icon: null, launched, launch: () => launched.push(id)};
}

async function setup({actions = fakeActions(), panels = [panel('gnome-wifi-panel.desktop', 'Wi-Fi', ['Réseau']), panel('gnome-sound-panel.desktop', 'Son', ['Volume'])], failActions = false} = {}) {
    const log = recordingLog();
    const provider = new SystemProvider({
        systemActions: async () => {
            if (failActions)
                throw new Error('no shell');
            return actions;
        },
        panels: () => panels,
    });
    await provider.init({gettext: text => text, log});
    const search = query => provider.search(query, {cancellable: new Gio.Cancellable(), limit: 4, emit() {}});
    return {provider, actions, panels, log, search};
}

const ids = results => results.map(result => result.id);

test('the provider honours the contract and keeps to itself', async () => {
    const t = await setup();
    validateProvider(t.provider);
    assertEquals(t.provider.id, 'system');
    assertEquals(t.provider.name, 'System');
    assertEquals(t.provider.topHitEligible, false);
    assert(t.provider.priority > 20, 'after the applications and the files');
    assertEquals(await t.provider.emptyQueryResults({limit: 5}), []);
});

test('every panel is offered, for the window to keep those that match', async () => {
    const t = await setup();
    const results = await t.search('wifi');
    assert(ids(results).includes('panel:gnome-wifi-panel.desktop'), 'the Wi-Fi panel');
    assert(ids(results).includes('panel:gnome-sound-panel.desktop'), 'the other panels too: ranking drops what does not match');
});

test('a panel is found by its name and by its keywords', async () => {
    const t = await setup();
    const results = await t.search('x');
    const wifi = results.find(result => result.id === 'panel:gnome-wifi-panel.desktop');
    assert(scoreResult(wifi, createMatcher('wifi'), null, 0) !== null, 'by name, whatever the hyphen');
    assert(scoreResult(wifi, createMatcher('reseau'), null, 0) !== null, 'by keyword, accents ignored');
    assert(scoreResult(wifi, createMatcher('imprimante'), null, 0) === null, 'not for something else');
});

test('the actions come from the shell\'s own keyword search, with its names', async () => {
    const t = await setup();
    const actions = (await t.search('verrou')).filter(result => result.data.kind === 'action');
    assertEquals(actions.map(result => result.data.action), ['lock-screen']);
    assertEquals(actions[0].title, 'Verrouiller l’écran');
    assertEquals((await t.search('eteindre')).filter(result => result.data.kind === 'action').map(result => result.data.action), ['power-off']);
    assertEquals((await t.search('zzz')).filter(result => result.data.kind === 'action'), []);
    assertEquals((await t.search('')).filter(result => result.data.kind === 'action'), [], 'an empty query matches no action');
});

test('what ends the session is marked to be chosen by hand', async () => {
    const t = await setup();
    const results = await t.search('re');
    const byAction = Object.fromEntries(results.filter(result => result.data.kind === 'action').map(result => [result.data.action, result]));
    assertEquals(Object.keys(byAction).sort(), ['restart']);
    assertEquals(byAction.restart.explicitSelectionOnly, true);
    assertEquals((await t.search('verrou')).find(result => result.data.kind === 'action').explicitSelectionOnly, undefined);
});

test('without the shell\'s list the panels are still there, and it is said once', async () => {
    const t = await setup({failActions: true});
    const results = await t.search('wifi');
    assert(results.length > 0 && results.every(result => result.data.kind === 'panel'), 'panels only');
    assertEquals(t.log.lines.filter(line => line.includes('no shell')).length, 1);
});

test('activating an action asks the shell for exactly that action', async () => {
    const t = await setup();
    const [lock] = (await t.search('verrou')).filter(result => result.data.kind === 'action');
    await t.provider.activate(lock);
    assertEquals(t.actions.activated, ['lock-screen']);
});

test('activating a panel opens that panel, and only if it is installed', async () => {
    const t = await setup();
    const results = await t.search('x');
    await t.provider.activate(results.find(result => result.id === 'panel:gnome-sound-panel.desktop'));
    assertEquals(t.panels[1].launched, ['gnome-sound-panel.desktop']);
    assertEquals(t.panels[0].launched, []);
    let failure = null;
    try {
        await t.provider.activate({id: 'panel:gnome-gone-panel.desktop', data: {kind: 'panel', panel: 'gnome-gone-panel.desktop'}});
    } catch (error) {
        failure = error.message;
    }
    assert(failure?.includes('not installed'), `got ${failure}`);
});

test('anything else is refused and runs nothing', async () => {
    const t = await setup();
    const refused = async result => {
        try {
            await t.provider.activate(result);
        } catch (error) {
            return error.message;
        }
        return null;
    };
    for (const result of [
        {id: 'action:format-disk', data: {kind: 'action', action: 'format-disk'}},
        {id: 'action:lock-screen', data: {kind: 'action', action: 'power-off'}},
        {id: 'action:power-off', data: {kind: 'panel', action: 'power-off'}},
        {id: 'x', data: {}}, {id: 'x'}, {id: 'panel:x', data: {kind: 'panel', panel: 5}},
        {id: 'panel:gnome-wifi-panel.desktop', data: {kind: 'panel', panel: 'gnome-sound-panel.desktop'}},
    ])
        assert(await refused(result) !== null, `accepted ${JSON.stringify(result)}`);
    assertEquals(t.actions.activated, []);
    assertEquals([...t.panels[0].launched, ...t.panels[1].launched], []);
});

test('an action is refused if the shell could not be reached', async () => {
    const t = await setup({failActions: true});
    let failure = null;
    try {
        await t.provider.activate({id: 'action:lock-screen', data: {kind: 'action', action: 'lock-screen'}});
    } catch (error) {
        failure = error.message;
    }
    assert(failure?.includes('not available'), `got ${failure}`);
});

test('typing "re" and pressing Enter can not restart anything: the action is not selected for the user', async () => {
    const t = await setup();
    const results = await t.search('re');
    const system = {id: 'system', name: 'System', priority: 25, topHitEligible: false};
    const scored = results.map(result => ({result, final: scoreResult(result, createMatcher('re'), null, 0)?.final ?? 0})).filter(entry => entry.final > 0);
    const merged = mergeResults([{provider: system, scored}]);
    assertEquals(merged.topHit, null, 'never the top hit');
    const restart = merged.items.find(item => item.result.data.action === 'restart');
    assert(restart !== undefined, 'the action is listed');
    assert(restart.result.explicitSelectionOnly === true, 'and marked');
});

test('the destroyed provider forgets everything', async () => {
    const t = await setup();
    t.provider.destroy();
    assertEquals(await t.search('wifi'), []);
});
