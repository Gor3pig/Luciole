// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import GLib from 'gi://GLib';

/**
 * Runs fn and, when debug logging is on, logs how long it took in
 * milliseconds. Costs two clock reads when debug is off. Returns fn's result.
 *
 * @param {{debug: (message: string) => void}} log
 * @param {string} label
 * @param {() => T} fn
 * @returns {T}
 * @template T
 */
export function measure(log, label, fn) {
    const start = GLib.get_monotonic_time();
    try {
        return fn();
    } finally {
        const ms = (GLib.get_monotonic_time() - start) / 1000;
        log.debug(`perf ${label}: ${ms.toFixed(2)} ms`);
    }
}
