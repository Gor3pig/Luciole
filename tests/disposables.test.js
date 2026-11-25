// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {Disposables} from '../src/core/disposables.js';
import {assert, assertEquals, assertThrows, test} from './harness.js';

test('dispose runs callbacks in reverse order of registration', () => {
    const calls = [];
    const d = new Disposables();
    d.add(() => calls.push('first'));
    d.add(() => calls.push('second'));
    d.add(() => calls.push('third'));
    d.dispose();
    assertEquals(calls, ['third', 'second', 'first']);
});

test('dispose is idempotent', () => {
    let count = 0;
    const d = new Disposables();
    d.add(() => count++);
    d.dispose();
    d.dispose();
    assertEquals(count, 1);
    assert(d.disposed, 'disposed flag');
    assertEquals(d.size, 0);
});

test('a failing callback does not stop the others and is reported', () => {
    const calls = [];
    const errors = [];
    const d = new Disposables(e => errors.push(e.message));
    d.add(() => calls.push('a'));
    d.add(() => {
        throw new Error('boom');
    });
    d.add(() => calls.push('c'));
    d.dispose();
    assertEquals(calls, ['c', 'a']);
    assertEquals(errors, ['boom']);
});

test('a throwing error reporter does not break disposal', () => {
    const calls = [];
    const d = new Disposables(() => {
        throw new Error('reporter failed');
    });
    d.add(() => calls.push('a'));
    d.add(() => {
        throw new Error('boom');
    });
    d.dispose();
    assertEquals(calls, ['a']);
});

test('a callback added after dispose runs immediately', () => {
    let ran = false;
    const d = new Disposables();
    d.dispose();
    d.add(() => {
        ran = true;
    });
    assert(ran, 'late callback must run at once');
    assertEquals(d.size, 0);
});

test('release runs one callback now and not again at dispose', () => {
    const calls = [];
    const d = new Disposables();
    const a = d.add(() => calls.push('a'));
    d.add(() => calls.push('b'));
    d.release(a);
    assertEquals(calls, ['a']);
    d.dispose();
    assertEquals(calls, ['a', 'b']);
});

test('release of an unknown callback runs nothing and keeps the others', () => {
    const calls = [];
    const d = new Disposables();
    d.add(() => calls.push('registered'));
    d.release(() => calls.push('unknown'));
    assertEquals(calls, []);
    assertEquals(d.size, 1);
    d.dispose();
    assertEquals(calls, ['registered']);
});

function fakeEmitter() {
    const handlers = new Map();
    let next = 1;
    return {
        handlers,
        connect(signal, fn) {
            handlers.set(next, {signal, fn});
            return next++;
        },
        disconnect(id) {
            if (!handlers.delete(id))
                throw new Error(`unknown handler ${id}`);
        },
    };
}

test('connect registers the handler and disconnects it on dispose', () => {
    const emitter = fakeEmitter();
    const d = new Disposables();
    const id = d.connect(emitter, 'changed', () => {});
    assertEquals(emitter.handlers.size, 1);
    assertEquals(emitter.handlers.get(id).signal, 'changed');
    d.dispose();
    assertEquals(emitter.handlers.size, 0);
});

test('connect after dispose disconnects at once', () => {
    const emitter = fakeEmitter();
    const d = new Disposables();
    d.dispose();
    d.connect(emitter, 'changed', () => {});
    assertEquals(emitter.handlers.size, 0);
});

test('add rejects anything that is not a function', () => {
    const d = new Disposables();
    const error = assertThrows(() => d.add('nope'));
    assert(error instanceof TypeError, 'TypeError expected');
});
