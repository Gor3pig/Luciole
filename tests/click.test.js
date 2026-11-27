// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {isDoubleClick} from '../src/core/click.js';
import {assert, test} from './harness.js';

const at = (key, time) => ({key, time});

test('two clicks on the same row within the delay make a double click', () => {
    assert(isDoubleClick(at('a', 1000), at('a', 1300), 400), 'within the delay');
    assert(isDoubleClick(at('a', 1000), at('a', 1400), 400), 'exactly at the delay');
    assert(isDoubleClick(at('a', 1000), at('a', 1000), 400), 'at the same moment');
});

test('a second click too late, or on another row, is a click of its own', () => {
    assert(!isDoubleClick(at('a', 1000), at('a', 1401), 400), 'too late');
    assert(!isDoubleClick(at('a', 1000), at('b', 1100), 400), 'another row');
});

test('a first click, a time going back or odd values never make a double click', () => {
    assert(!isDoubleClick(null, at('a', 1000), 400), 'no click before');
    assert(!isDoubleClick(at('a', 1000), at('a', 900), 400), 'the time went back');
    assert(!isDoubleClick(at('a', NaN), at('a', 1000), 400), 'no time before');
    assert(!isDoubleClick(at('a', 1000), at('a', Infinity), 400), 'no time now');
    assert(!isDoubleClick(at('a', 1000), at('a', 1100), 0), 'no delay');
    assert(!isDoubleClick(at('a', 1000), at('a', 1000), 0), 'no delay, at the same moment');
    assert(!isDoubleClick(at('a', 1000), at('a', 1000), -5), 'a negative delay');
    assert(!isDoubleClick(at('a', 1000), at('a', 1100), NaN), 'an odd delay');
    assert(!isDoubleClick({key: 3, time: 1000}, {key: 3, time: 1100}, 400), 'a key that is not a text');
    assert(!isDoubleClick(at('a', 1000), null, 400), 'no click now');
    assert(!isDoubleClick({time: 1000}, {time: 1100}, 400), 'clicks on no row');
});
