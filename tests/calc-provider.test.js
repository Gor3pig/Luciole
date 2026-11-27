// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';

import {Frecency} from '../src/core/frecency.js';
import {mergeResults} from '../src/core/merge.js';
import {createMatcher} from '../src/core/matching.js';
import {scoreResult} from '../src/core/scoring.js';
import {SearchController} from '../src/core/session.js';
import {validateProvider} from '../src/core/provider.js';
import {CalcProvider, sessionDecimalMark} from '../src/providers/calc.js';
import {FakeScheduler} from './fakes/scheduler.js';
import {recordingLog} from './fakes/provider.js';
import {assert, assertEquals, test} from './harness.js';

async function setup(decimal = '.') {
    const copied = [];
    const provider = new CalcProvider({copyText: text => copied.push(text), decimal});
    await provider.init({gettext: text => `[${text}]`});
    const search = query => provider.search(query, {cancellable: new Gio.Cancellable(), limit: 1, emit() {}});
    return {provider, copied, search};
}

test('the provider honours the contract and keeps to itself', async () => {
    const {provider} = await setup();
    validateProvider(provider);
    assertEquals(provider.id, 'calc');
    assertEquals(provider.name, '[Calculator]');
    assert(provider.priority < 10, 'before the applications');
    assertEquals(provider.topHitEligible, false);
    assertEquals(provider.maxResults, 1);
});

test('a calculation gives one result: the answer as title, the calculation as subtitle', async () => {
    const t = await setup();
    const [result] = await t.search('2 + 2 * 3');
    assertEquals(result.title, '8');
    assertEquals(result.subtitle, '2 + 2 * 3 · [Enter to copy]');
    assertEquals(result.data, {copy: '8', full: '2 + 2 * 3 = 8'});
    assertEquals((await t.search('2 + 2 * 3')).length, 1);
});

test('what is not a calculation gives no result, and neither does an empty query', async () => {
    const t = await setup();
    for (const text of ['firefox', '2026', '', '1/0', 'sqrt(-1)', '5 km en kg'])
        assertEquals(await t.search(text), [], JSON.stringify(text));
    assertEquals(await t.provider.emptyQueryResults({limit: 5}), []);
});

test('the answer is shown with the decimal mark of the language', async () => {
    assertEquals((await (await setup(',')).search('1/4'))[0].title, '0,25');
    assertEquals((await (await setup('.')).search('1/4'))[0].title, '0.25');
    assertEquals((await (await setup('x')).search('1/4'))[0].title, '0.25', 'anything else is a point');
});

test('a conversion shows the unit', async () => {
    const t = await setup(',');
    const [result] = await t.search('5 km en m');
    assertEquals(result.title, '5000 m');
    assertEquals(result.data.full, '5 km = 5000 m');
});

test('activating the result copies the answer, nothing else', async () => {
    const t = await setup();
    const [result] = await t.search('10 / 4');
    await t.provider.activate(result);
    assertEquals(t.copied, ['2.5']);
});

test('the result says it was copied once activated', async () => {
    const t = await setup();
    const [result] = await t.search('10 / 4');
    assertEquals(result.activationConfirmation, '[Result copied]');
});

test('the menu offers to copy the result (the main action) or the whole calculation', async () => {
    const t = await setup();
    const [result] = await t.search('10 / 4');
    const actions = await t.provider.actions(result);
    assertEquals(actions.map(action => action.id), ['open', 'copy-full']);
    assertEquals(actions[0].label, '[Copy Result]');
    assertEquals(actions[1].copy, '10 / 4 = 2.5');
    assertEquals(actions[1].confirmation, '[Calculation copied]');
});

test('the result always scores well enough to be shown, whatever the typed text', async () => {
    const t = await setup();
    for (const text of ['2 + 2 * 3', '(12,5 + 7,5) × 3 − 4', '20 % de 150', '5 km en miles', 'sqrt(16) + 1']) {
        const [result] = await t.search(text);
        const scored = scoreResult(result, createMatcher(text), new Frecency(), 0);
        assert(scored !== null && scored.final >= 0.9, `${text} scored ${scored?.final}`);
    }
});

test('in the list the answer comes first, in its own section, and the best application is the top hit', async () => {
    const t = await setup();
    const [result] = await t.search('2 + 2');
    const apps = {id: 'apps', name: 'Applications', priority: 10};
    const merged = mergeResults([
        {provider: apps, scored: [{result: {id: 'fx', title: 'Firefox'}, final: 0.9, ranges: []}]},
        {provider: t.provider, scored: [{result, final: 1, ranges: []}]},
    ]);
    assertEquals(merged.topHit.result.title, 'Firefox');
    assertEquals(merged.items.map(item => item.result.title), ['Firefox', '4']);
    assertEquals(merged.sections.map(section => section.providerId), ['calc']);
});

test('the controller shows the answer for a calculation, and Enter copies it through the provider', async () => {
    const copied = [];
    const provider = new CalcProvider({copyText: text => copied.push(text), decimal: '.'});
    await provider.init({gettext: text => text});
    const updates = [];
    const controller = new SearchController({
        getProviders: () => [provider], frecency: new Frecency(), scheduler: new FakeScheduler(), log: recordingLog(),
        onUpdate: merged => updates.push(merged),
    });
    await controller.search('3 * 4');
    const last = updates[updates.length - 1];
    assertEquals(last.items.map(item => item.result.title), ['12']);
    assert(await controller.activate(last.items[0]), 'activated');
    assertEquals(copied, ['12']);
});

test('the decimal mark of the session is a comma or a point', () => {
    assert(['.', ','].includes(sessionDecimalMark()), `got ${sessionDecimalMark()}`);
});

test('the symbols of computing units follow the language of the session', async () => {
    const french = {MB: 'Mo', GB: 'Go'};
    const provider = new CalcProvider({copyText() {}, decimal: ','});
    await provider.init({gettext: text => french[text] ?? text});
    const [result] = await provider.search('1 GB en MB', {cancellable: new Gio.Cancellable(), limit: 1, emit() {}});
    assertEquals(result.title, '1000 Mo');
});
