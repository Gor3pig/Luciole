// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Frequency and recency of use, kept per item.
//
// Each item remembers its last activations. An activation weighs more the more
// recent it is (Firefox-style age buckets); the weights add up and are squashed
// into 0..1. The class is pure data: reading and writing the file is done by
// the caller, with serialize() and Frecency.from().

const DAY_MS = 24 * 60 * 60 * 1000;
const BUCKETS = [
    {maxAgeDays: 4, weight: 100},
    {maxAgeDays: 14, weight: 70},
    {maxAgeDays: 31, weight: 50},
    {maxAgeDays: 90, weight: 30},
];
const OLD_WEIGHT = 10;
const HALF_SCORE_AT = 300;

export const MAX_ACTIVATIONS_PER_KEY = 10;
export const MAX_KEYS = 500;
const FORGET_AFTER_DAYS = 365;

function weightOf(ageMs) {
    const days = Math.max(0, ageMs) / DAY_MS;
    for (const bucket of BUCKETS) {
        if (days <= bucket.maxAgeDays)
            return bucket.weight;
    }
    return OLD_WEIGHT;
}

export class Frecency {
    /** @type {Map<string, number[]>} */
    #entries = new Map();
    #dirty = false;

    /** Rebuilds from the output of serialize(); ignores anything malformed. */
    static from(data) {
        const frecency = new Frecency();
        const entries = data && typeof data === 'object' ? data.entries : null;
        if (!entries || typeof entries !== 'object')
            return frecency;
        for (const [key, times] of Object.entries(entries)) {
            if (!Array.isArray(times))
                continue;
            const clean = times.filter(t => Number.isFinite(t))
                .sort((a, b) => a - b).slice(-MAX_ACTIVATIONS_PER_KEY);
            if (clean.length > 0)
                frecency.#entries.set(key, clean);
        }
        return frecency;
    }

    get size() {
        return this.#entries.size;
    }

    /** True when something changed since the last markSaved(). */
    get dirty() {
        return this.#dirty;
    }

    markSaved() {
        this.#dirty = false;
    }

    /** Records one activation of an item at the given time (ms since the epoch). */
    record(key, now) {
        const times = this.#entries.get(key) ?? [];
        times.push(now);
        this.#entries.set(key, times.slice(-MAX_ACTIVATIONS_PER_KEY));
        this.#dirty = true;
        this.#prune(now);
    }

    /** 0 for an unknown item, approaching 1 for one used often and recently. */
    score(key, now) {
        const times = this.#entries.get(key);
        if (!times)
            return 0;
        const raw = times.reduce((sum, t) => sum + weightOf(now - t), 0);
        return raw / (raw + HALF_SCORE_AT);
    }

    /** The best-scoring keys that start with a prefix, best first. */
    top(prefix, limit, now) {
        const ranked = [];
        for (const key of this.#entries.keys()) {
            if (key.startsWith(prefix))
                ranked.push({key, score: this.score(key, now)});
        }
        ranked.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
        return ranked.slice(0, limit).map(entry => entry.key);
    }

    forget(key) {
        if (this.#entries.delete(key))
            this.#dirty = true;
    }

    clear() {
        if (this.#entries.size > 0)
            this.#dirty = true;
        this.#entries.clear();
    }

    serialize() {
        return {version: 1, entries: Object.fromEntries(this.#entries)};
    }

    // Keeps the file small: forgets what has not been used for a year, then the
    // least recently used keys beyond the cap.
    #prune(now) {
        const limit = now - FORGET_AFTER_DAYS * DAY_MS;
        for (const [key, times] of this.#entries) {
            if (times[times.length - 1] < limit)
                this.#entries.delete(key);
        }
        if (this.#entries.size <= MAX_KEYS)
            return;
        const byLastUse = [...this.#entries].sort((a, b) =>
            a[1][a[1].length - 1] - b[1][b[1].length - 1]);
        for (const [key] of byLastUse.slice(0, this.#entries.size - MAX_KEYS))
            this.#entries.delete(key);
    }
}
