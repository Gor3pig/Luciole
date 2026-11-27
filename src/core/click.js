// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Whether two clicks make a double click. Pure, so it is tested without a shell: the window only
// hands over which row was clicked, when (the event's time, in milliseconds), and the desktop's
// double-click delay.

/**
 * @param {{key: string, time: number} | null} previous - the click before, or null
 * @param {{key: string, time: number}} current
 * @param {number} delay - the longest gap of a double click, in milliseconds
 * @returns {boolean} true when both clicks hit the same row, the second within the delay
 */
export function isDoubleClick(previous, current, delay) {
    if (typeof previous?.key !== 'string' || previous.key !== current?.key)
        return false;
    // Any comparison with a missing time (NaN) is false: such a click never pairs.
    const gap = current.time - previous.time;
    return delay > 0 && gap >= 0 && gap <= delay;
}
