// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {Provider, validateProvider} from '../src/core/provider.js';
import {ProviderRegistry} from '../src/core/registry.js';
import {recordingLog} from './fakes/provider.js';
import {assert, assertEquals, assertThrows, test} from './harness.js';

class Simple extends Provider {
    constructor(id, hooks = {}) {
        super();
        this._id = id;
        this.hooks = hooks;
        this.destroyed = 0;
        this.inits = 0;
    }

    get id() {
        return this._id;
    }

    async init() {
        this.inits++;
        await this.hooks.init?.();
    }

    destroy() {
        this.destroyed++;
        this.hooks.destroy?.();
    }
}

test('registering creates nothing', () => {
    let created = 0;
    const registry = new ProviderRegistry({log: recordingLog()});
    registry.register('apps', () => {
        created++;
        return new Simple('apps');
    });
    assertEquals(created, 0);
    assertEquals(registry.ids, ['apps']);
    assertEquals(registry.providers, []);
});

test('the same id cannot be registered twice', () => {
    const registry = new ProviderRegistry({log: recordingLog()});
    registry.register('apps', () => new Simple('apps'));
    assertThrows(() => registry.register('apps', () => new Simple('apps')));
});

test('start creates and initialises the enabled providers in the given order', async () => {
    const registry = new ProviderRegistry({log: recordingLog()});
    registry.register('apps', () => new Simple('apps'));
    registry.register('files', () => new Simple('files'));
    registry.register('calc', () => new Simple('calc'));
    await registry.start({}, ['files', 'apps']);
    assertEquals(registry.providers.map(p => p.id), ['files', 'apps']);
    assert(registry.providers.every(p => p.inits === 1), 'initialised once');
});

test('a provider whose init fails is skipped, logged and cleaned up; the others start', async () => {
    const log = recordingLog();
    const registry = new ProviderRegistry({log});
    const broken = new Simple('broken', {
        init() {
            throw new Error('no index');
        },
    });
    registry.register('broken', () => broken);
    registry.register('apps', () => new Simple('apps'));
    await registry.start({}, ['broken', 'apps']);
    assertEquals(registry.providers.map(p => p.id), ['apps']);
    assertEquals(broken.destroyed, 1);
    assert(log.lines.some(l => l.includes('"broken" could not start') && l.includes('no index')), log.lines.join('\n'));
});

test('a factory that throws is logged and skipped', async () => {
    const log = recordingLog();
    const registry = new ProviderRegistry({log});
    registry.register('bad', () => {
        throw new Error('boom');
    });
    registry.register('apps', () => new Simple('apps'));
    await registry.start({}, ['bad', 'apps']);
    assertEquals(registry.providers.map(p => p.id), ['apps']);
    assert(log.lines.some(l => l.includes('"bad" could not start')), 'logged');
});

test('an object that does not honour the contract is rejected', async () => {
    const log = recordingLog();
    const registry = new ProviderRegistry({log});
    let initialised = false;
    registry.register('odd', () => ({
        id: 'odd',
        priority: 1,
        debounceMs: 0,
        timeoutMs: 1,
        maxResults: 1,
        async init() {
            initialised = true;
        },
        activate() {},
    }));
    await registry.start({}, ['odd']);
    assertEquals(registry.providers, []);
    assert(!initialised, 'a provider that breaks the contract is never initialised');
    assert(log.lines.some(l => l.includes('"odd" could not start')), 'logged');
});

test('an unknown id is skipped with a warning', async () => {
    const log = recordingLog();
    const registry = new ProviderRegistry({log});
    await registry.start({}, ['ghost']);
    assert(log.lines.some(l => l.startsWith('warn:') && l.includes('ghost')), 'warned');
});

test('stop destroys providers, last started first, and is safe twice', async () => {
    const order = [];
    const registry = new ProviderRegistry({log: recordingLog()});
    registry.register('a', () => new Simple('a', {destroy: () => order.push('a')}));
    registry.register('b', () => new Simple('b', {destroy: () => order.push('b')}));
    await registry.start({}, ['a', 'b']);
    registry.stop();
    registry.stop();
    assertEquals(order, ['b', 'a']);
    assertEquals(registry.providers, []);
});

test('a provider that fails to clean up does not stop the others', async () => {
    const log = recordingLog();
    const registry = new ProviderRegistry({log});
    const calls = [];
    registry.register('a', () => new Simple('a', {destroy: () => calls.push('a')}));
    registry.register('b', () => new Simple('b', {
        destroy() {
            throw new Error('stuck');
        },
    }));
    await registry.start({}, ['a', 'b']);
    registry.stop();
    assertEquals(calls, ['a']);
    assert(log.lines.some(l => l.includes('failed to clean up')), 'logged');
});

test('validateProvider accepts a base class instance and rejects bad shapes', () => {
    validateProvider(new Simple('ok'));
    assertEquals(new Simple('ok').scoreWeight, 1, 'a provider counts fully by default');
    assertThrows(() => validateProvider(null));
    assertThrows(() => validateProvider({id: '', search() {}, activate() {}}));
    assertThrows(() => validateProvider({id: 'x', activate() {}}));
    assertThrows(() => validateProvider({id: 'x', search() {}}));
    const noNumbers = new Simple('n');
    Object.defineProperty(noNumbers, 'timeoutMs', {value: 'soon'});
    assertThrows(() => validateProvider(noNumbers));
    const noWeight = new Simple('w');
    Object.defineProperty(noWeight, 'scoreWeight', {value: 'heavy'});
    assertThrows(() => validateProvider(noWeight));
});

test('a provider missing search() or activate() is rejected even if the rest is valid', () => {
    const noSearch = new Simple('a');
    Object.defineProperty(noSearch, 'search', {value: undefined});
    assertThrows(() => validateProvider(noSearch));
    const noActivate = new Simple('b');
    Object.defineProperty(noActivate, 'activate', {value: undefined});
    assertThrows(() => validateProvider(noActivate));
});
