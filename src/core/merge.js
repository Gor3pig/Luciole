/**
 * @typedef {object} Item
 * @property {string} key - "<provider id>:<result id>", unique
 * @property {string} providerId
 * @property {object} result - the provider's result
 * @property {number} final - the score the order is based on
 * @property {Array<[number, number]>} ranges
 */

const compareItems = (a, b) =>
    b.final - a.final ||
    a.result.title.length - b.result.title.length ||
    a.result.title.localeCompare(b.result.title);

/**
 * Merges what the providers returned into what the window shows: an optional
 * top hit, then one section per provider, in provider priority order.
 *
 * @param {Array<{provider: {id: string, name: string, priority: number, maxResults?: number}, scored: Array<{result: object, final: number, ranges: Array}>}>} entries
 * @param {object} [options]
 * @param {number} [options.topHitMin] - minimum score for a top hit
 * @param {boolean} [options.topHit] - false to never pick a top hit
 * @param {number} [options.maxTotal] - cap on the number of items shown
 * @returns {{topHit: Item | null, sections: Array<{providerId: string, title: string, items: Item[]}>, items: Item[]}}
 */
export function mergeResults(entries, {topHitMin = 0.55, topHit = true, maxTotal = 30} = {}) {
    // One item per key, and one per dedupeKey across providers: the best score wins.
    const byKey = new Map();
    const byDedupe = new Map();
    for (const {provider, scored} of entries) {
        for (const s of scored) {
            const item = {
                key: `${provider.id}:${s.result.id}`,
                providerId: provider.id,
                result: s.result,
                final: s.final,
                ranges: s.ranges,
            };
            const known = byKey.get(item.key);
            if (known && known.final >= item.final)
                continue;
            byKey.set(item.key, item);
        }
    }
    for (const item of byKey.values()) {
        const dedupe = item.result.dedupeKey;
        if (dedupe === undefined)
            continue;
        const known = byDedupe.get(dedupe);
        if (!known || item.final > known.final)
            byDedupe.set(dedupe, item);
    }
    const dropped = new Set();
    for (const item of byKey.values()) {
        const dedupe = item.result.dedupeKey;
        if (dedupe !== undefined && byDedupe.get(dedupe) !== item)
            dropped.add(item.key);
    }

    const sections = [];
    for (const {provider} of [...entries].sort((a, b) => a.provider.priority - b.provider.priority)) {
        if (sections.some(section => section.providerId === provider.id))
            continue;
        const items = [...byKey.values()]
            .filter(item => item.providerId === provider.id && !dropped.has(item.key))
            .sort(compareItems)
            .slice(0, provider.maxResults ?? Infinity);
        sections.push({providerId: provider.id, title: provider.name, items});
    }

    let top = null;
    if (topHit) {
        for (const section of sections) {
            const first = section.items[0];
            if (first && first.final >= topHitMin && (!top || first.final > top.final))
                top = first;
        }
        if (top) {
            const section = sections.find(s => s.providerId === top.providerId);
            section.items = section.items.filter(item => item !== top);
        }
    }

    // Enforce the overall cap, dropping from the last section upwards.
    let budget = maxTotal - (top ? 1 : 0);
    for (const section of sections) {
        section.items = section.items.slice(0, Math.max(0, budget));
        budget -= section.items.length;
    }

    const visible = sections.filter(section => section.items.length > 0);
    return {
        topHit: top,
        sections: visible,
        items: [...(top ? [top] : []), ...visible.flatMap(section => section.items)],
    };
}

/**
 * Which item stays selected when the list changes. The selection follows the
 * best result until the user moves it; once they have, it stays on the same
 * item as long as that item is still there, so late results never move it.
 *
 * @param {string | null} previousKey
 * @param {Item[]} items
 * @param {boolean} userNavigated
 * @returns {string | null}
 */
export function nextSelection(previousKey, items, userNavigated) {
    if (items.length === 0)
        return null;
    if (userNavigated && previousKey !== null && items.some(item => item.key === previousKey))
        return previousKey;
    return items[0].key;
}

/**
 * Tab and Shift+Tab move between sections: the selection goes to the first item
 * of the next (or previous) group, wrapping around. The top hit counts as a
 * group of its own, as it is shown under its own heading.
 *
 * @param {ReturnType<typeof mergeResults>} merged
 * @param {string | null} currentKey
 * @param {1 | -1} direction
 * @returns {string | null} the key to select, null when there is nothing to select
 */
export function jumpSection(merged, currentKey, direction) {
    const groups = [];
    if (merged.topHit)
        groups.push([merged.topHit]);
    for (const section of merged.sections)
        groups.push(section.items);
    const firsts = groups.filter(group => group.length > 0).map(group => group[0].key);
    if (firsts.length === 0)
        return null;
    const current = groups.findIndex(group => group.some(item => item.key === currentKey));
    const here = current < 0 ? -1 : firsts.indexOf(groups[current][0].key);
    if (here < 0)
        return firsts[direction > 0 ? 0 : firsts.length - 1];
    return firsts[(here + direction + firsts.length) % firsts.length];
}
