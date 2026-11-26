// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Where the launcher goes on the screen. Pure arithmetic, so it is tested
// without a shell: the shell side only feeds it numbers.

// The text field sits this far from the top of its monitor, as a fraction of
// the monitor height: about a quarter, high enough to read the results below it.
export const TOP_FRACTION = 0.25;
// Room kept free under the results, as a fraction of the monitor height.
const BOTTOM_FRACTION = 0.1;
// Height set aside for the text field and the panel's own padding.
const ENTRY_RESERVE = 80;
const MIN_RESULTS_HEIGHT = 120;
const MAX_RESULTS_HEIGHT = 600;

function isIndex(value, count) {
    return Number.isInteger(value) && value >= 0 && value < count;
}

/**
 * Picks the monitor the launcher appears on: the one of the window that has the
 * focus, else the one the pointer is on, else the primary one, else the first.
 * Each hint may be missing or stale (a monitor that just went away), so every
 * one is checked against the monitors that exist.
 *
 * @param {object} hints
 * @param {number} hints.count - how many monitors there are
 * @param {number} [hints.focusIndex] - monitor of the focused window, if any
 * @param {number} [hints.pointerIndex] - monitor under the pointer
 * @param {number} [hints.primaryIndex]
 * @returns {number} an index in [0, count), or -1 when there is no monitor
 */
export function chooseMonitorIndex({count, focusIndex, pointerIndex, primaryIndex}) {
    if (!Number.isInteger(count) || count <= 0)
        return -1;
    for (const candidate of [focusIndex, pointerIndex, primaryIndex]) {
        if (isIndex(candidate, count))
            return candidate;
    }
    return 0;
}

/**
 * The vertical layout for a monitor of the given height, in pixels: the distance
 * from the top to the text field, and the most height the results may take before
 * they scroll, which is whatever room is left below the field.
 *
 * @param {number} monitorHeight
 * @returns {{top: number, resultsMax: number}}
 */
export function verticalLayout(monitorHeight) {
    const height = Number.isFinite(monitorHeight) && monitorHeight > 0 ? monitorHeight : 0;
    const top = Math.round(height * TOP_FRACTION);
    const room = height - top - ENTRY_RESERVE - Math.round(height * BOTTOM_FRACTION);
    const resultsMax = Math.min(MAX_RESULTS_HEIGHT, Math.max(MIN_RESULTS_HEIGHT, Math.round(room)));
    return {top, resultsMax};
}

const BACKDROPS = ['light', 'standard'];

/**
 * The style class for the dimming behind the launcher, from the "backdrop" setting.
 * "none", and anything unknown, gives no class: no dimming is the safe reading.
 *
 * @param {unknown} level
 * @returns {string | null}
 */
export function backdropClass(level) {
    return BACKDROPS.includes(level) ? `luciole-backdrop-${level}` : null;
}
