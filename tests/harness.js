// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Minimal test harness for plain gjs: no dependency, no shell.

const registry = [];

export function test(name, fn) {
    registry.push({name, fn});
}

/** Returns the tests registered since the last call, and forgets them. */
export function takeTests() {
    return registry.splice(0);
}

export function assert(condition, message = 'assertion failed') {
    if (!condition)
        throw new Error(message);
}

export function assertEquals(actual, expected, message = '') {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`${message ? `${message}: ` : ''}expected ${e}, got ${a}`);
}

export function assertThrows(fn, message = 'expected a throw') {
    try {
        fn();
    } catch (error) {
        return error;
    }
    throw new Error(message);
}
