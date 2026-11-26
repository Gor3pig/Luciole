// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {backdropClass, chooseMonitorIndex, motionEnabled, systemMotion, needsHeightEase, TOP_FRACTION, verticalLayout} from '../src/core/layout.js';
import {assert, assertEquals, test} from './harness.js';

test('the monitor of the focused window wins over the pointer and the primary one', () => {
    assertEquals(chooseMonitorIndex({count: 3, focusIndex: 2, pointerIndex: 1, primaryIndex: 0}), 2);
});

test('without a focused window the pointer decides, then the primary monitor', () => {
    assertEquals(chooseMonitorIndex({count: 3, pointerIndex: 1, primaryIndex: 0}), 1);
    assertEquals(chooseMonitorIndex({count: 3, focusIndex: -1, pointerIndex: -1, primaryIndex: 2}), 2);
});

test('a stale hint (a monitor that went away) is ignored', () => {
    assertEquals(chooseMonitorIndex({count: 2, focusIndex: 5, pointerIndex: 1, primaryIndex: 0}), 1);
    assertEquals(chooseMonitorIndex({count: 1, focusIndex: 1, pointerIndex: 2, primaryIndex: 3}), 0);
});

test('hints that are not whole numbers are ignored', () => {
    assertEquals(chooseMonitorIndex({count: 2, focusIndex: 0.5, pointerIndex: NaN, primaryIndex: 1}), 1);
    assertEquals(chooseMonitorIndex({count: 2, focusIndex: '1', pointerIndex: null, primaryIndex: undefined}), 0);
});

test('no monitor at all gives -1', () => {
    assertEquals(chooseMonitorIndex({count: 0, focusIndex: 0}), -1);
    assertEquals(chooseMonitorIndex({count: NaN}), -1);
});

test('the field sits a quarter of the way down', () => {
    assertEquals(TOP_FRACTION, 0.25);
    assertEquals(verticalLayout(720).top, 180);
    assertEquals(verticalLayout(1080).top, 270);
});

test('the results take the room left below the field, within limits', () => {
    // 720 high: 720 - 180 (top) - 80 (field) - 72 (bottom margin) = 388
    assertEquals(verticalLayout(720).resultsMax, 388);
    // 1080 high: 1080 - 270 - 80 - 108 = 622, capped at 600
    assertEquals(verticalLayout(1080).resultsMax, 600);
    // a very small monitor still gets a usable list
    assertEquals(verticalLayout(300).resultsMax, 120);
});

test('the layout never fails on an absurd height', () => {
    for (const height of [0, -5, NaN, Infinity, undefined, null, 1e9]) {
        const {top, resultsMax} = verticalLayout(height);
        assert(Number.isFinite(top) && top >= 0, `top ${top} for ${height}`);
        assert(resultsMax >= 120 && resultsMax <= 600, `resultsMax ${resultsMax} for ${height}`);
    }
});

test('the backdrop setting gives a style class, and nothing for none or anything unknown', () => {
    assertEquals(backdropClass('light'), 'luciole-backdrop-light');
    assertEquals(backdropClass('standard'), 'luciole-backdrop-standard');
    assertEquals(backdropClass('none'), null);
    for (const odd of ['', 'LIGHT', 'dark', 'standard ', undefined, null, 3, {}, ['light']])
        assertEquals(backdropClass(odd), null, `for ${JSON.stringify(odd)}`);
});

test('the animations setting can switch animations off but never force them on', () => {
    assertEquals(motionEnabled(true, true), true);
    assertEquals(motionEnabled(true, false), false);
    assertEquals(motionEnabled(false, true), false);
    assertEquals(motionEnabled(false, false), false);
});

test('an unreadable animations setting counts as on, an unreadable system answer as off', () => {
    for (const odd of [undefined, null, 0, 'false', {}])
        assertEquals(motionEnabled(true, odd), true, `setting ${JSON.stringify(odd)}`);
    for (const odd of [undefined, null, 1, 'true', {}])
        assertEquals(motionEnabled(odd, true), false, `system ${JSON.stringify(odd)}`);
});

test('a list changing height is eased only between two real, different heights', () => {
    assertEquals(needsHeightEase(100, 200), true);
    assertEquals(needsHeightEase(200, 100), true);
    assertEquals(needsHeightEase(100, 100), false);
    assertEquals(needsHeightEase(100, 100.5), false);
    assertEquals(needsHeightEase(100, 101), true);
    assertEquals(needsHeightEase(0, 200), false, 'the first appearance is not eased');
    assertEquals(needsHeightEase(200, 0), false);
    for (const odd of [NaN, Infinity, -5, undefined, null, '100'])
        assertEquals(needsHeightEase(odd, 200), false, `from ${String(odd)}`);
});

test('the system lets the interface move unless animations are off or reduced motion is asked', () => {
    const REDUCE = 1;
    assertEquals(systemMotion({enableAnimations: true, reducedMotion: 0, reduceValue: REDUCE}), true);
    assertEquals(systemMotion({enableAnimations: true, reducedMotion: REDUCE, reduceValue: REDUCE}), false, 'reduced motion');
    assertEquals(systemMotion({enableAnimations: false, reducedMotion: 0, reduceValue: REDUCE}), false, 'animations off');
    assertEquals(systemMotion({enableAnimations: undefined, reduceValue: REDUCE}), false, 'unknown is off');
    assertEquals(systemMotion({enableAnimations: 1, reduceValue: REDUCE}), false, 'only a real true');
});

test('on GNOME 50, which has no reduced motion setting, the animations switch alone decides', () => {
    assertEquals(systemMotion({enableAnimations: true, reducedMotion: undefined, reduceValue: undefined}), true);
    assertEquals(systemMotion({enableAnimations: false, reducedMotion: undefined, reduceValue: undefined}), false);
});
