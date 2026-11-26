// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {Frecency} from '../src/core/frecency.js';
import {QueryHistory} from '../src/core/query-history.js';
import {SearchController} from '../src/core/session.js';
import {FakeScheduler} from './fakes/scheduler.js';
import {cancelledError, fakeProvider, recordingLog, result} from './fakes/provider.js';
import {assert, assertEquals, test} from './harness.js';

function setup(providers, extra = {}) {
    const scheduler = new FakeScheduler();
    const log = recordingLog();
    const frecency = new Frecency();
    const updates = [];
    const controller = new SearchController({
        getProviders: () => providers,
        frecency,
        scheduler,
        log,
        onUpdate: (merged, state) => updates.push({titles: merged.items.map(i => i.result.title), done: state.done}),
        ...extra,
    });
    return {scheduler, log, frecency, updates, controller};
}

const lastTitles = updates => updates[updates.length - 1]?.titles ?? [];

test('a search shows the matching results of every provider', async () => {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps', priority: 1, results: [result('1', 'Firefox'), result('2', 'Files')]});
    const files = fakeProvider(scheduler, {id: 'files', priority: 2, results: [result('3', 'Fiche.odt')]});
    const s = setup([apps, files]);
    s.controller = new SearchController({
        getProviders: () => [apps, files], frecency: s.frecency, scheduler, log: s.log,
        onUpdate: (merged, state) => s.updates.push({titles: merged.items.map(i => i.result.title), done: state.done}),
    });
    const done = s.controller.search('fi');
    await scheduler.tick();
    await done;
    assertEquals(lastTitles(s.updates).sort(), ['Fiche.odt', 'Files', 'Firefox']);
    assert(s.updates[s.updates.length - 1].done, 'final update marked done');
});

test('results that do not match the query are left out', async () => {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps', results: [result('1', 'Firefox'), result('2', 'Calculator')]});
    const s = setup([apps]);
    const c = new SearchController({
        getProviders: () => [apps], frecency: s.frecency, scheduler, log: s.log,
        onUpdate: (merged, state) => s.updates.push({titles: merged.items.map(i => i.result.title), done: state.done}),
    });
    await c.search('fire');
    assertEquals(lastTitles(s.updates), ['Firefox']);
});

test('a slow provider does not delay the fast one', async () => {
    const scheduler = new FakeScheduler();
    const fast = fakeProvider(scheduler, {id: 'apps', priority: 1, latency: 0, results: [result('1', 'Firefox')]});
    const slow = fakeProvider(scheduler, {id: 'files', priority: 2, latency: 300, results: [result('2', 'Fiche.odt')]});
    const s = setup([fast, slow]);
    const c = new SearchController({
        getProviders: () => [fast, slow], frecency: s.frecency, scheduler, log: s.log,
        onUpdate: (merged, state) => s.updates.push({titles: merged.items.map(i => i.result.title), done: state.done}),
    });
    const done = c.search('fi');
    await scheduler.tick();
    assertEquals(lastTitles(s.updates), ['Firefox']);
    assert(!s.updates[s.updates.length - 1].done, 'not done while the slow provider works');
    await scheduler.advance(300);
    await done;
    assertEquals(lastTitles(s.updates).sort(), ['Fiche.odt', 'Firefox']);
    assert(s.updates[s.updates.length - 1].done, 'done at the end');
});

test('a provider that throws is logged and the others still answer', async () => {
    const scheduler = new FakeScheduler();
    const broken = fakeProvider(scheduler, {id: 'broken', error: new Error('index corrupted')});
    const apps = fakeProvider(scheduler, {id: 'apps', results: [result('1', 'Firefox')]});
    const log = recordingLog();
    const updates = [];
    const c = new SearchController({
        getProviders: () => [broken, apps], frecency: new Frecency(), scheduler, log,
        onUpdate: m => updates.push(m.items.map(i => i.result.title)),
    });
    await c.search('fire');
    assertEquals(updates[updates.length - 1], ['Firefox']);
    assertEquals(log.lines.filter(l => l.includes('"broken" failed')).length, 1);
});

test('a provider that takes too long is given up on, with a warning', async () => {
    const scheduler = new FakeScheduler();
    const stuck = fakeProvider(scheduler, {id: 'files', latency: 5000, timeoutMs: 200, results: [result('1', 'Fiche.odt')]});
    const apps = fakeProvider(scheduler, {id: 'apps', results: [result('2', 'Firefox')]});
    const log = recordingLog();
    const updates = [];
    const c = new SearchController({
        getProviders: () => [apps, stuck], frecency: new Frecency(), scheduler, log,
        onUpdate: (m, state) => updates.push({titles: m.items.map(i => i.result.title), done: state.done}),
    });
    const done = c.search('fi');
    await scheduler.advance(200);
    await done;
    assertEquals(updates[updates.length - 1], {titles: ['Firefox'], done: true});
    assert(stuck.cancellables[0].is_cancelled(), 'the timed-out provider is told to stop');
    assert(log.lines.some(l => l.startsWith('warn:') && l.includes('"files"') && l.includes('200 ms')), log.lines.join('\n'));
    // The provider was cancelled: it neither logs an error nor shows its late results.
    await scheduler.advance(6000);
    assertEquals(log.lines.filter(l => l.startsWith('error:')).length, 0);
    assertEquals(updates[updates.length - 1], {titles: ['Firefox'], done: true});
});

test('a new keystroke cancels the previous search and ignores its late answer', async () => {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps', latency: 100, results: q => [result('1', q === 'f' ? 'Fedora' : 'Firefox')]});
    const log = recordingLog();
    const updates = [];
    const c = new SearchController({
        getProviders: () => [apps], frecency: new Frecency(), scheduler, log,
        onUpdate: m => updates.push(m.items.map(i => i.result.title)),
    });
    c.search('f');
    await scheduler.advance(50);
    const second = c.search('fi');
    await scheduler.advance(100);
    await second;
    assertEquals(updates[updates.length - 1], ['Firefox']);
    assert(updates.every(u => !u.includes('Fedora')), 'the cancelled search never shows');
    assertEquals(log.lines.filter(l => l.startsWith('error:')).length, 0);
});

test('a cancelled search does not log its cancellation as an error', async () => {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps', latency: 100, results: [result('1', 'Firefox')]});
    const log = recordingLog();
    const c = new SearchController({
        getProviders: () => [apps], frecency: new Frecency(), scheduler, log, onUpdate() {},
    });
    c.search('fi');
    await scheduler.advance(10);
    c.search('fir');
    await scheduler.advance(200);
    assertEquals(log.lines, []);
});

test('debounce delays an expensive provider, and the next keystroke cancels the wait', async () => {
    const scheduler = new FakeScheduler();
    const files = fakeProvider(scheduler, {id: 'files', debounceMs: 100, results: [result('1', 'Fiche.odt')]});
    const c = new SearchController({
        getProviders: () => [files], frecency: new Frecency(), scheduler, log: recordingLog(), onUpdate() {},
    });
    c.search('f');
    await scheduler.advance(60);
    assertEquals(files.searches, []);
    c.search('fi');
    await scheduler.advance(60);
    assertEquals(files.searches, [], 'the first wait was cancelled and the second has not elapsed');
    await scheduler.advance(60);
    assertEquals(files.searches, ['fi']);
});

test('a provider without debounce is asked at once', async () => {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps', debounceMs: 0, results: []});
    const c = new SearchController({
        getProviders: () => [apps], frecency: new Frecency(), scheduler, log: recordingLog(), onUpdate() {},
    });
    c.search('fi');
    await scheduler.tick();
    assertEquals(apps.searches, ['fi']);
});

test('results arriving together are shown in one update per frame', async () => {
    const scheduler = new FakeScheduler();
    const a = fakeProvider(scheduler, {id: 'a', priority: 1, results: [result('1', 'Firefox')]});
    const b = fakeProvider(scheduler, {id: 'b', priority: 2, results: [result('2', 'Files')]});
    const updates = [];
    const c = new SearchController({
        getProviders: () => [a, b], frecency: new Frecency(), scheduler, log: recordingLog(),
        onUpdate: (m, state) => updates.push(state.done),
    });
    const done = c.search('fi');
    await scheduler.tick();
    await done;
    assertEquals(updates.length, 1, 'one coalesced update, not one per provider');
});

test('an empty query shows each provider\'s recent items, ranked by frecency', async () => {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps', recents: [
        result('1', 'Firefox', {frecencyKey: 'apps:1'}),
        result('2', 'Terminal', {frecencyKey: 'apps:2'}),
    ]});
    const frecency = new Frecency();
    for (let i = 0; i < 10; i++)
        frecency.record('apps:2', scheduler.now());
    const updates = [];
    const c = new SearchController({
        getProviders: () => [apps], frecency, scheduler, log: recordingLog(),
        onUpdate: m => updates.push({titles: m.items.map(i => i.result.title), top: m.topHit}),
    });
    await c.search('   ');
    assertEquals(updates[updates.length - 1], {titles: ['Terminal', 'Firefox'], top: null});
    assertEquals(apps.searches, [], 'search() is not used for an empty query');
});

test('a result without an id or a title, or a non-list answer, is ignored with a warning', async () => {
    const scheduler = new FakeScheduler();
    const odd = fakeProvider(scheduler, {id: 'odd', results: [{title: 'no id'}, {id: 'x'}, result('3', 'Firefox')]});
    const worse = fakeProvider(scheduler, {id: 'worse', results: 'not a list'});
    const log = recordingLog();
    const updates = [];
    const c = new SearchController({
        getProviders: () => [odd, worse], frecency: new Frecency(), scheduler, log,
        onUpdate: m => updates.push(m.items.map(i => i.result.title)),
    });
    await c.search('fire');
    assertEquals(updates[updates.length - 1], ['Firefox']);
    assertEquals(log.lines.filter(l => l.includes('without id or title')).length, 2);
    assertEquals(log.lines.filter(l => l.includes('not a list')).length, 1);
});

test('a throwing onUpdate is contained', async () => {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps', results: [result('1', 'Firefox')]});
    const log = recordingLog();
    const c = new SearchController({
        getProviders: () => [apps], frecency: new Frecency(), scheduler, log,
        onUpdate() {
            throw new Error('ui exploded');
        },
    });
    await c.search('fi');
    assert(log.lines.some(l => l.includes('updating the results') && l.includes('ui exploded')), 'logged');
});

test('activating an item runs it and records it for frecency', async () => {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps', results: [result('1', 'Firefox', {frecencyKey: 'apps:1'})]});
    const frecency = new Frecency();
    let changed = 0;
    const c = new SearchController({
        getProviders: () => [apps], frecency, scheduler, log: recordingLog(), onUpdate() {}, onFrecencyChange: () => changed++,
    });
    const ok = await c.activate({key: 'apps:1', providerId: 'apps', result: result('1', 'Firefox', {frecencyKey: 'apps:1'})});
    assert(ok, 'activated');
    assertEquals(apps.activated, ['1']);
    assert(frecency.score('apps:1', scheduler.now()) > 0, 'frecency recorded');
    assertEquals(changed, 1);
});

test('a failing activation is logged and not recorded', async () => {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps'});
    apps.activate = async () => {
        throw new Error('cannot launch');
    };
    const log = recordingLog();
    const frecency = new Frecency();
    const c = new SearchController({getProviders: () => [apps], frecency, scheduler, log, onUpdate() {}});
    const ok = await c.activate({key: 'apps:1', providerId: 'apps', result: result('1', 'Firefox', {frecencyKey: 'apps:1'})});
    assertEquals(ok, false);
    assertEquals(frecency.score('apps:1', scheduler.now()), 0);
    assert(log.lines.some(l => l.includes('cannot launch')), 'logged');
});

test('activating an item of an unknown provider does nothing', async () => {
    const scheduler = new FakeScheduler();
    const c = new SearchController({getProviders: () => [], frecency: new Frecency(), scheduler, log: recordingLog(), onUpdate() {}});
    assertEquals(await c.activate({key: 'x:1', providerId: 'x', result: result('1', 'X')}), false);
});

test('dispose ignores whatever arrives afterwards', async () => {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps', latency: 100, results: [result('1', 'Firefox')]});
    const updates = [];
    const c = new SearchController({
        getProviders: () => [apps], frecency: new Frecency(), scheduler, log: recordingLog(),
        onUpdate: m => updates.push(m.items.length),
    });
    c.search('fi');
    await scheduler.advance(50);
    c.dispose();
    await scheduler.advance(200);
    assertEquals(updates, []);
});

test('providers can hand results over early with emit', async () => {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps'});
    apps.search = async (query, {emit, cancellable}) => {
        emit([result('1', 'Firefox')]);
        await scheduler.sleep(300, cancellable);
        return [result('2', 'Files')];
    };
    const updates = [];
    const c = new SearchController({
        getProviders: () => [apps], frecency: new Frecency(), scheduler, log: recordingLog(),
        onUpdate: m => updates.push(m.items.map(i => i.result.title)),
    });
    const done = c.search('fi');
    await scheduler.tick();
    assertEquals(updates[updates.length - 1], ['Firefox']);
    await scheduler.advance(300);
    await done;
    assertEquals(updates[updates.length - 1].sort(), ['Files', 'Firefox']);
});

test('the controller leaves no timer behind after a finished search', async () => {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps', debounceMs: 50, results: [result('1', 'Firefox')]});
    const c = new SearchController({
        getProviders: () => [apps], frecency: new Frecency(), scheduler, log: recordingLog(), onUpdate() {},
    });
    const done = c.search('fi');
    await scheduler.advance(60);
    await done;
    assertEquals(scheduler.pendingTimers, 0);
});

test('the provider of a replaced search is told to stop', async () => {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps', latency: 100, results: [result('1', 'Firefox')]});
    const c = new SearchController({
        getProviders: () => [apps], frecency: new Frecency(), scheduler, log: recordingLog(), onUpdate() {},
    });
    c.search('f');
    await scheduler.advance(10);
    c.search('fi');
    await scheduler.advance(10);
    assert(apps.cancellables[0].is_cancelled(), 'first search cancelled');
    assert(!apps.cancellables[1].is_cancelled(), 'second search still running');
});

test('a late answer from a provider that ignores cancellation is not shown', async () => {
    const scheduler = new FakeScheduler();
    const stubborn = fakeProvider(scheduler, {id: 'apps'});
    stubborn.search = async () => {
        await scheduler.sleep(100);
        return [result('1', 'Firefox')];
    };
    const updates = [];
    const c = new SearchController({
        getProviders: () => [stubborn], frecency: new Frecency(), scheduler, log: recordingLog(),
        onUpdate: m => updates.push(m.items.length),
    });
    c.search('fi');
    await scheduler.advance(10);
    c.dispose();
    await scheduler.advance(200);
    assertEquals(updates, []);
});

test('a provider that reports its own cancellation is not an error', async () => {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps'});
    apps.search = async () => {
        throw cancelledError();
    };
    const log = recordingLog();
    const c = new SearchController({
        getProviders: () => [apps], frecency: new Frecency(), scheduler, log, onUpdate() {},
    });
    await c.search('fi');
    assertEquals(log.lines, []);
});

test('the secondary action of an item runs through its provider', async () => {
    const scheduler = new FakeScheduler();
    const files = fakeProvider(scheduler, {id: 'files'});
    files.secondaryActions = () => [{id: 'open-folder'}, {id: 'other'}];
    const c = new SearchController({
        getProviders: () => [files], frecency: new Frecency(), scheduler, log: recordingLog(), onUpdate() {},
    });
    const ok = await c.activateSecondary({key: 'files:1', providerId: 'files', result: result('1', 'a.odt')});
    assert(ok, 'ran');
    assertEquals(files.actions, ['open-folder:1'], 'only the first action');
});

test('an item whose provider has no secondary action does nothing', async () => {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps'});
    const c = new SearchController({
        getProviders: () => [apps], frecency: new Frecency(), scheduler, log: recordingLog(), onUpdate() {},
    });
    assertEquals(await c.activateSecondary({key: 'apps:1', providerId: 'apps', result: result('1', 'A')}), false);
    assertEquals(await c.activateSecondary({key: 'x:1', providerId: 'x', result: result('1', 'X')}), false);
    assertEquals(apps.actions, []);
});

test('a failing secondary action is logged, not thrown', async () => {
    const scheduler = new FakeScheduler();
    const files = fakeProvider(scheduler, {id: 'files'});
    files.secondaryActions = () => [{id: 'open-folder'}];
    files.activateAction = async () => {
        throw new Error('no file manager');
    };
    const log = recordingLog();
    const c = new SearchController({getProviders: () => [files], frecency: new Frecency(), scheduler, log, onUpdate() {}});
    assertEquals(await c.activateSecondary({key: 'files:1', providerId: 'files', result: result('1', 'a')}), false);
    assert(log.lines.some(l => l.includes('no file manager')), 'logged');
});

test('a provider\'s weight lowers its scores against the others', async () => {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps', priority: 2, results: [result('1', 'Facture Express')]});
    const files = fakeProvider(scheduler, {id: 'files', priority: 1, scoreWeight: 0.9, results: [result('2', 'Facture mars.pdf', {providerScore: 1})]});
    const updates = [];
    const c = new SearchController({
        getProviders: () => [files, apps], frecency: new Frecency(), scheduler, log: recordingLog(),
        onUpdate: m => updates.push({titles: m.items.map(i => i.result.title), finals: m.items.map(i => i.final)}),
    });
    await c.search('factu');
    const last = updates[updates.length - 1];
    assertEquals(last.titles[0], 'Facture Express', 'the application first despite the file coming first in priority');
    assert(Math.abs(last.finals[1] - 0.9 * 0.96) < 1e-9, `file score is weighted: ${last.finals[1]}`);
});

const RLO = String.fromCodePoint(0x202e);

async function shown(results, query = 'rep') {
    const scheduler = new FakeScheduler();
    const provider = fakeProvider(scheduler, {id: 'files', results});
    const items = [];
    const log = recordingLog();
    const controller = new SearchController({
        getProviders: () => [provider], frecency: new Frecency(), scheduler, log,
        onUpdate: merged => {
            items.length = 0;
            items.push(...merged.items.map(i => i.result));
        },
    });
    await controller.search(query);
    return {items, log};
}

test('what providers return is cleaned before it is shown: spoofing characters and line breaks', async () => {
    const {items} = await shown([result('1', `report${RLO}fdp.exe`, {subtitle: 'in\nfolder'})]);
    assertEquals(items.length, 1);
    assertEquals(items[0].title, 'reportfdp.exe');
    assertEquals(items[0].subtitle, 'in folder');
    assertEquals(items[0].id, '1', 'the identity is never touched');
});

test('the texts that are matched are cleaned too, so the highlight stays on the shown title', async () => {
    const dirty = `Rep${RLO}ort`;
    const {items} = await shown([result('1', dirty, {matchFields: [{text: dirty}, {text: 'zzz', weight: 0.5}]})]);
    assertEquals(items[0].title, 'Report');
    assertEquals(items[0].matchFields[0].text, 'Report');
});

test('a result with nothing left to show as a title is dropped, with a warning', async () => {
    const {items, log} = await shown([result('1', `${RLO}\n `), result('2', 'Report')]);
    assertEquals(items.map(i => i.id), ['2']);
    assert(log.lines.some(line => line.startsWith('warn:') && line.includes('nothing to show')), 'no warning');
});

test('a clean result is shown as it is, without being copied', async () => {
    const original = result('1', 'Report', {subtitle: 'Documents', matchFields: ['Report']});
    const {items} = await shown([original]);
    assert(items[0] === original, 'a clean result was needlessly copied');
});

test('when every matched text is emptied by the cleaning, the result is still found by its title', async () => {
    const {items} = await shown([result('1', 'Report', {matchFields: [{text: RLO}, RLO]})]);
    assertEquals(items.map(i => i.title), ['Report']);
});

// Searches that led to opening a result.
function historySetup({remember = () => true, secondary = false} = {}) {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps', results: [result('1', 'Firefox', {frecencyKey: 'apps:1'})]});
    if (secondary) {
        apps.secondaryActions = () => [{id: 'folder'}];
    }
    const queryHistory = new QueryHistory();
    const changes = [];
    const log = recordingLog();
    const controller = new SearchController({
        getProviders: () => [apps], frecency: new Frecency(), scheduler, log, onUpdate() {},
        queryHistory, rememberQueries: remember, onQueryHistoryChange: () => changes.push(1),
    });
    const item = {key: 'apps:1', providerId: 'apps', result: result('1', 'Firefox', {frecencyKey: 'apps:1'})};
    return {apps, queryHistory, changes, log, controller, item};
}

test('a search that led to opening a result is remembered', async () => {
    const t = historySetup();
    await t.controller.search('  fire ');
    assert(await t.controller.activate(t.item), 'activated');
    assertEquals(t.queryHistory.entries, ['fire']);
    assertEquals(t.changes.length, 1);
});

test('the secondary action (show in folder) remembers the search too', async () => {
    const t = historySetup({secondary: true});
    await t.controller.search('notes');
    assert(await t.controller.activateSecondary(t.item), 'action done');
    assertEquals(t.queryHistory.entries, ['notes']);
});

test('a search that was typed but led nowhere is not remembered', async () => {
    const t = historySetup();
    await t.controller.search('fire');
    await t.controller.search('firef');
    assertEquals(t.queryHistory.entries, []);
    assertEquals(t.changes.length, 0);
});

test('opening a result from the empty field remembers nothing', async () => {
    const t = historySetup();
    await t.controller.search('');
    await t.controller.activate(t.item);
    assertEquals(t.queryHistory.entries, []);
});

test('a failed activation does not remember the search', async () => {
    const t = historySetup();
    t.apps.activate = async () => {
        throw new Error('cannot launch');
    };
    await t.controller.search('fire');
    assertEquals(await t.controller.activate(t.item), false);
    assertEquals(t.queryHistory.entries, []);
});

test('with the setting off nothing is remembered', async () => {
    const t = historySetup({remember: () => false});
    await t.controller.search('fire');
    await t.controller.activate(t.item);
    assertEquals(t.queryHistory.entries, []);
    assertEquals(t.changes.length, 0);
});

test('a setting that cannot be read counts as off, and is logged', async () => {
    const t = historySetup({remember: () => {
        throw new Error('settings gone');
    }});
    await t.controller.search('fire');
    await t.controller.activate(t.item);
    assertEquals(t.queryHistory.entries, []);
    assert(t.log.lines.some(l => l.includes('settings gone')), 'logged');
});

test('the search remembered is the one of the moment the result was chosen', async () => {
    const t = historySetup();
    await t.controller.search('fire');
    const pending = t.controller.activate(t.item);
    await t.controller.search('something else typed meanwhile');
    await pending;
    assertEquals(t.queryHistory.entries, ['fire']);
});

test('without a history object the controller still works', async () => {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps'});
    const c = new SearchController({getProviders: () => [apps], frecency: new Frecency(), scheduler, log: recordingLog(), onUpdate() {}});
    await c.search('fire');
    assert(await c.activate({key: 'apps:1', providerId: 'apps', result: result('1', 'Firefox')}), 'activated');
});

// Restricting the search to one source.
function filterSetup() {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps', priority: 1, results: [result('1', 'Firefox')], recents: [result('1', 'Firefox')]});
    const files = fakeProvider(scheduler, {id: 'files', priority: 2, results: [result('2', 'Fiche.odt')]});
    const updates = [];
    const controller = new SearchController({
        getProviders: () => [apps, files], frecency: new Frecency(), scheduler, log: recordingLog(),
        onUpdate: (merged, state) => updates.push({sections: merged.sections.map(s => s.providerId), top: merged.topHit?.providerId ?? null, done: state.done}),
    });
    return {apps, files, controller, updates};
}

test('with a source chosen, only that source is searched and shown', async () => {
    const t = filterSetup();
    t.controller.setFilter('files');
    await t.controller.search('fi');
    assertEquals(t.apps.searches, [], 'the other source is not even asked');
    assertEquals(t.files.searches, ['fi']);
    assertEquals(t.updates[t.updates.length - 1].sections, ['files']);
});

test('with a source chosen there is no top hit, the results are that source\'s section', async () => {
    const t = filterSetup();
    await t.controller.search('fi');
    assert(t.updates[t.updates.length - 1].top !== null, 'a top hit without a filter');
    t.controller.setFilter('apps');
    await t.controller.search('fi');
    assertEquals(t.updates[t.updates.length - 1].top, null);
});

test('choosing everything again searches every source', async () => {
    const t = filterSetup();
    t.controller.setFilter('files');
    t.controller.setFilter(null);
    await t.controller.search('fi');
    assertEquals(t.apps.searches, ['fi']);
    assertEquals(t.files.searches, ['fi']);
});

test('a source that is gone counts as everything', async () => {
    const t = filterSetup();
    t.controller.setFilter('removed');
    await t.controller.search('fi');
    assertEquals(t.apps.searches, ['fi']);
    assertEquals(t.files.searches, ['fi']);
    assert(t.updates[t.updates.length - 1].top !== null, 'the top hit is back');
});

test('a filter that is not an identifier is ignored', async () => {
    const t = filterSetup();
    for (const odd of [undefined, 5, {}, ['files']])
        t.controller.setFilter(odd);
    await t.controller.search('fi');
    assertEquals(t.files.searches, ['fi']);
    assertEquals(t.apps.searches, ['fi']);
});

test('the categories are the sources, and none when there is only one', () => {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps'});
    const files = fakeProvider(scheduler, {id: 'files'});
    const two = new SearchController({getProviders: () => [apps, files], frecency: new Frecency(), scheduler, log: recordingLog(), onUpdate() {}});
    assertEquals(two.categories().map(c => c.id), ['apps', 'files']);
    const one = new SearchController({getProviders: () => [apps], frecency: new Frecency(), scheduler, log: recordingLog(), onUpdate() {}});
    assertEquals(one.categories(), []);
});

test('opening a result still works for a source other than the chosen one', async () => {
    const t = filterSetup();
    t.controller.setFilter('files');
    assert(await t.controller.activate({key: 'apps:1', providerId: 'apps', result: result('1', 'Firefox')}), 'activated');
    assertEquals(t.apps.activated, ['1']);
});

// The menu of a result.
function menuSetup(extra = {}) {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps', results: [result('1', 'Firefox', {frecencyKey: 'apps:1'})]});
    Object.assign(apps, extra);
    const copied = [];
    const queryHistory = new QueryHistory();
    const log = recordingLog();
    const controller = new SearchController({
        getProviders: () => [apps], frecency: new Frecency(), scheduler, log, onUpdate() {},
        gettext: text => `[${text}]`, copyText: text => copied.push(text),
        queryHistory, rememberQueries: () => true,
    });
    const item = {key: 'apps:1', providerId: 'apps', result: result('1', 'Firefox', {frecencyKey: 'apps:1'})};
    return {apps, copied, queryHistory, log, controller, item};
}

test('the menu of a result starts with Open, then what its source offers', async () => {
    const t = menuSetup({actions: async () => [{id: 'new-window', label: 'New Window'}]});
    assertEquals((await t.controller.actionsFor(t.item)).map(action => action.id), ['open', 'new-window']);
    assertEquals((await t.controller.actionsFor(t.item))[0].label, '[Open]', 'its text is translated');
});

test('a source with no actions, or one that fails, offers only Open', async () => {
    const none = menuSetup();
    assertEquals((await none.controller.actionsFor(none.item)).map(action => action.id), ['open']);
    const broken = menuSetup({actions: async () => {
        throw new Error('desktop file unreadable');
    }});
    assertEquals((await broken.controller.actionsFor(broken.item)).map(action => action.id), ['open']);
    assert(broken.log.lines.some(l => l.includes('desktop file unreadable')), 'logged');
});

test('what a source offers is checked: malformed actions are dropped', async () => {
    const t = menuSetup({actions: async () => [null, {id: 'x'}, {id: 'ok', label: 'Fine'}, {id: 'ok', label: 'Twice'}]});
    assertEquals((await t.controller.actionsFor(t.item)).map(action => action.id), ['open', 'ok']);
    assertEquals((await t.controller.actionsFor(t.item))[0].label, '[Open]', 'the controller\'s own Open comes first');
});

test('a source may word the main action its own way, and it stays first and alone', async () => {
    const t = menuSetup({actions: async () => [{id: 'other', label: 'Other'}, {id: 'open', label: 'Copy Result'}, {id: 'open', label: 'Again'}]});
    const actions = await t.controller.actionsFor(t.item);
    assertEquals(actions.map(action => action.id), ['open', 'other']);
    assertEquals(actions[0].label, 'Copy Result');
});

test('the actions of a result of an unknown source are just Open', async () => {
    const t = menuSetup();
    assertEquals((await t.controller.actionsFor({key: 'x:1', providerId: 'gone', result: result('1', 'X')})).map(action => action.id), ['open']);
});

test('a submenu lists what its source says, without submenus inside it', async () => {
    const t = menuSetup({subActions: async () => [{id: 'a', label: 'A'}, {id: 'b', label: 'B', submenu: true}]});
    const choices = await t.controller.subActionsFor(t.item, {id: 'open-with', submenu: true});
    assertEquals(choices.map(choice => choice.id), ['a']);
    assertEquals(await t.controller.subActionsFor(t.item, {id: 'open-with'}), [], 'only an action that leads to a submenu');
    assertEquals(await t.controller.subActionsFor(t.item, null), []);
});

test('a copy action only writes to the clipboard, and gives its confirmation', async () => {
    const t = menuSetup();
    await t.controller.search('fire');
    const outcome = await t.controller.runAction(t.item, {id: 'copy-path', copy: '/home/me/a.txt', confirmation: 'Path copied'});
    assertEquals(outcome, {ok: true, confirmation: 'Path copied'});
    assertEquals(t.copied, ['/home/me/a.txt']);
    assertEquals(t.apps.activated, [], 'nothing was opened');
    assertEquals(t.queryHistory.entries, [], 'a copy is not opening a result');
});

test('a copy that fails is reported as failed, without a confirmation', async () => {
    const scheduler = new FakeScheduler();
    const apps = fakeProvider(scheduler, {id: 'apps'});
    const log = recordingLog();
    const controller = new SearchController({
        getProviders: () => [apps], frecency: new Frecency(), scheduler, log, onUpdate() {},
        copyText: () => {
            throw new Error('no clipboard');
        },
    });
    const outcome = await controller.runAction({key: 'apps:1', providerId: 'apps', result: result('1', 'X')}, {id: 'copy-name', copy: 'x', confirmation: 'Copied'});
    assertEquals(outcome, {ok: false, confirmation: null});
    assert(log.lines.some(l => l.includes('no clipboard')), 'logged');
});

test('the Open action opens the result like Enter does', async () => {
    const t = menuSetup();
    await t.controller.search('fire');
    assertEquals((await t.controller.runAction(t.item, {id: 'open'})).ok, true);
    assertEquals(t.apps.activated, ['1']);
    assertEquals(t.queryHistory.entries, ['fire']);
});

test('another action is run by its source, and the search that led to it is remembered', async () => {
    const t = menuSetup();
    await t.controller.search('fire');
    const outcome = await t.controller.runAction(t.item, {id: 'new-window'});
    assertEquals(outcome, {ok: true, confirmation: null});
    assertEquals(t.apps.actions, ['new-window:1']);
    assertEquals(t.queryHistory.entries, ['fire']);
});

test('an action that fails is logged, reported as failed, and not remembered', async () => {
    const t = menuSetup();
    t.apps.activateAction = async () => {
        throw new Error('cannot start');
    };
    await t.controller.search('fire');
    assertEquals((await t.controller.runAction(t.item, {id: 'new-window'})).ok, false);
    assertEquals(t.queryHistory.entries, []);
    assert(t.log.lines.some(l => l.includes('cannot start')), 'logged');
});

test('nothing runs for a missing action, an action without an id, or a source that is gone', async () => {
    const t = menuSetup();
    for (const odd of [null, undefined, {}, {id: 5}, 'open'])
        assertEquals((await t.controller.runAction(t.item, odd)).ok, false, JSON.stringify(odd));
    assertEquals((await t.controller.runAction({key: 'x:1', providerId: 'gone', result: result('1', 'X')}, {id: 'new-window'})).ok, false);
    assertEquals(t.apps.actions, []);
    assertEquals(t.apps.activated, []);
});

test('the file to preview comes from the source, and only a local file address is passed on', async () => {
    const make = previewUri => {
        const scheduler = new FakeScheduler();
        const files = fakeProvider(scheduler, {id: 'files'});
        if (previewUri)
            files.previewUri = previewUri;
        const log = recordingLog();
        return {log, controller: new SearchController({getProviders: () => [files], frecency: new Frecency(), scheduler, log, onUpdate() {}})};
    };
    const item = {key: 'files:1', providerId: 'files', result: result('1', 'a.txt')};
    assertEquals(await make(async () => 'file:///home/me/a.txt').controller.previewUriFor(item), 'file:///home/me/a.txt');
    for (const odd of ['https://example.org/a', 'file://host/a', 'smb://x', '', null, 5])
        assertEquals(await make(async () => odd).controller.previewUriFor(item), null, String(odd));
    assertEquals(await make(null).controller.previewUriFor(item), null, 'a source that cannot preview');
    const failing = make(async () => {
        throw new Error('disk gone');
    });
    assertEquals(await failing.controller.previewUriFor(item), null);
    assert(failing.log.lines.some(line => line.includes('disk gone')), 'logged');
    assertEquals(await make(async () => 'file:///a').controller.previewUriFor({key: 'x', providerId: 'gone', result: result('1', 'x')}), null);
});
