import {Frecency, MAX_ACTIVATIONS_PER_KEY, MAX_KEYS} from '../src/core/frecency.js';
import {assert, assertEquals, test} from './harness.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

test('an unknown item scores 0', () => {
    assertEquals(new Frecency().score('apps:x', NOW), 0);
});

test('the score grows with every use up to the cap, and stays below 1', () => {
    const f = new Frecency();
    let previous = 0;
    for (let i = 0; i < MAX_ACTIVATIONS_PER_KEY; i++) {
        f.record('apps:x', NOW);
        const s = f.score('apps:x', NOW);
        assert(s > previous && s < 1, `use ${i}: ${s}`);
        previous = s;
    }
    f.record('apps:x', NOW);
    assertEquals(f.score('apps:x', NOW), previous, 'beyond the cap it no longer grows');
});

test('a recent use counts more than an old one', () => {
    const f = new Frecency();
    f.record('recent', NOW - 1 * DAY);
    f.record('month', NOW - 20 * DAY);
    f.record('old', NOW - 200 * DAY);
    const [recent, month, old] = ['recent', 'month', 'old'].map(key => f.score(key, NOW));
    assert(recent > month && month > old && old > 0, `${recent} ${month} ${old}`);
});

test('several recent uses beat a single one', () => {
    const f = new Frecency();
    f.record('often', NOW);
    f.record('often', NOW);
    f.record('often', NOW);
    f.record('once', NOW);
    assert(f.score('often', NOW) > f.score('once', NOW), 'often > once');
});

test('only the latest activations of an item are kept', () => {
    const f = new Frecency();
    for (let i = 0; i < MAX_ACTIVATIONS_PER_KEY + 5; i++)
        f.record('x', NOW + i);
    assertEquals(f.serialize().entries.x.length, MAX_ACTIVATIONS_PER_KEY);
    assertEquals(f.serialize().entries.x[0], NOW + 5);
});

test('items unused for a year are forgotten', () => {
    const f = new Frecency();
    f.record('stale', NOW - 400 * DAY);
    f.record('fresh', NOW);
    assertEquals(f.score('stale', NOW), 0);
    assert(f.score('fresh', NOW) > 0, 'fresh kept');
});

test('the number of items is capped, dropping the least recently used', () => {
    const f = new Frecency();
    for (let i = 0; i < MAX_KEYS + 20; i++)
        f.record(`k${i}`, NOW + i);
    assertEquals(f.size, MAX_KEYS);
    assertEquals(f.score('k0', NOW + 1000), 0);
    assert(f.score(`k${MAX_KEYS + 19}`, NOW + 1000) > 0, 'newest kept');
});

test('serialize then from gives the same scores', () => {
    const f = new Frecency();
    f.record('a', NOW - 2 * DAY);
    f.record('a', NOW);
    f.record('b', NOW - 30 * DAY);
    const copy = Frecency.from(JSON.parse(JSON.stringify(f.serialize())));
    for (const key of ['a', 'b', 'missing'])
        assertEquals(copy.score(key, NOW), f.score(key, NOW), key);
});

test('from ignores malformed data instead of failing', () => {
    for (const bad of [null, undefined, 'text', 42, {}, {entries: null}, {entries: 'x'}, {entries: {a: 'nope', b: [NaN, 'x'], c: [NOW]}}]) {
        const f = Frecency.from(bad);
        assert(f instanceof Frecency, 'still a Frecency');
    }
    const f = Frecency.from({entries: {a: 'nope', b: [NaN, 'x'], c: [NOW]}});
    assertEquals(f.size, 1);
    assert(f.score('c', NOW) > 0, 'valid entry kept');
});

test('top lists the best keys under a prefix', () => {
    const f = new Frecency();
    f.record('apps:one', NOW - 10 * DAY);
    f.record('apps:two', NOW);
    f.record('apps:two', NOW);
    f.record('files:three', NOW);
    assertEquals(f.top('apps:', 5, NOW), ['apps:two', 'apps:one']);
    assertEquals(f.top('apps:', 1, NOW), ['apps:two']);
});

test('dirty is set by changes and cleared by markSaved', () => {
    const f = new Frecency();
    assert(!f.dirty, 'new is clean');
    f.record('a', NOW);
    assert(f.dirty, 'dirty after record');
    f.markSaved();
    assert(!f.dirty, 'clean after save');
    f.forget('a');
    assert(f.dirty, 'dirty after forget');
    f.markSaved();
    f.clear();
    assert(f.dirty === false, 'clearing nothing is not a change');
});

test('forget and clear remove items', () => {
    const f = new Frecency();
    f.record('a', NOW);
    f.record('b', NOW);
    f.forget('a');
    assertEquals(f.score('a', NOW), 0);
    f.clear();
    assertEquals(f.size, 0);
});

test('forgetting an unknown item is not a change', () => {
    const f = new Frecency();
    f.forget('nothing');
    assert(!f.dirty, 'still clean');
});
