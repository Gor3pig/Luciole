import {Frecency} from '../src/core/frecency.js';
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
