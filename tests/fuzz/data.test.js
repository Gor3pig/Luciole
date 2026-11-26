// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {Frecency, MAX_ACTIVATIONS_PER_KEY, MAX_KEYS} from '../../src/core/frecency.js';
import {jumpSection, mergeResults, nextSelection} from '../../src/core/merge.js';
import {ActionMenu, cleanActions, MAX_ACTIONS, MAX_COPY_CHARS} from '../../src/core/action-menu.js';
import {evaluateQuery, MAX_INPUT} from '../../src/core/calc.js';
import {HistoryCursor, MAX_QUERIES, MAX_QUERY_CHARS, QueryHistory} from '../../src/core/query-history.js';
import {
    buildFtsTerms, displayFolder, isExcluded, isExcludedType, pathOfUrl, rowsToResults,
} from '../../src/providers/files-query.js';
import {assert, assertEquals, test} from '../harness.js';
import {ALPHABETS, forAll} from './random.js';

test('fuzz: the full-text query is made of plain words and stars, whatever was typed', () => {
    forAll('buildFtsTerms', random => {
        const terms = buildFtsTerms(random.string(ALPHABETS.everything, 40));
        if (terms === null)
            return;
        assert(/^[\p{L}\p{N}]+\*( [\p{L}\p{N}]+\*)*$/u.test(terms), `unsafe query: ${JSON.stringify(terms)}`);
        assert(terms.split(' ').length <= 5, 'too many words');
    });
});

test('fuzz: hostile queries never reach the index as anything but plain words', () => {
    forAll('hostile', random => {
        const raw = `${random.string(ALPHABETS.hostile, 10)} ${random.pick(['OR', 'AND', 'NOT', 'NEAR', '*', '"'])} ${random.string(ALPHABETS.hostile, 10)}`;
        const terms = buildFtsTerms(raw);
        assert(terms === null || !/["'()^:\\-]/.test(terms), `operator survived: ${JSON.stringify(terms)}`);
    });
});

function randomJson(random, depth = 0) {
    const kind = random.int(0, depth > 2 ? 4 : 6);
    switch (kind) {
    case 0: return null;
    case 1: return random.int(-1e9, 1e9);
    case 2: return random.string(ALPHABETS.everything, 12);
    case 3: return random.chance(0.5);
    case 4: return random.pick([NaN, Infinity, -Infinity, 1e308, -0]);
    case 5: return Array.from({length: random.int(0, 4)}, () => randomJson(random, depth + 1));
    default: {
        const object = {};
        for (let n = random.int(0, 4); n > 0; n--)
            object[random.pick(['entries', 'version', 'x', random.string(ALPHABETS.ascii, 6)])] = randomJson(random, depth + 1);
        return object;
    }
    }
}

test('fuzz: a corrupt or hostile history file never breaks loading', () => {
    forAll('Frecency.from', random => {
        const data = random.chance(0.5)
            ? randomJson(random)
            : {entries: Object.fromEntries(Array.from({length: random.int(0, 6)}, () => [
                random.string(ALPHABETS.everything, 10), randomJson(random),
            ]))};
        const frecency = Frecency.from(data);
        assert(frecency.size <= MAX_KEYS, 'too many keys');
        for (const times of Object.values(frecency.serialize().entries)) {
            assert(times.length <= MAX_ACTIVATIONS_PER_KEY, 'too many activations');
            assert(times.every(Number.isFinite), 'a non-finite time survived');
        }
        const score = frecency.score(random.string(ALPHABETS.ascii, 5), 1_700_000_000_000);
        assert(score >= 0 && score < 1, `score ${score}`);
    });
});

test('fuzz: recording and saving keeps the history bounded and reloadable', () => {
    forAll('Frecency.record', random => {
        const frecency = new Frecency();
        const now = 1_700_000_000_000;
        for (let n = random.int(0, 60); n > 0; n--)
            frecency.record(`k${random.int(0, 900)}`, now - random.int(0, 400) * 86_400_000);
        assert(frecency.size <= MAX_KEYS, 'too many keys');
        const copy = Frecency.from(JSON.parse(JSON.stringify(frecency.serialize())));
        for (const key of ['k1', 'k2', 'k3', 'k500'])
            assertEquals(copy.score(key, now), frecency.score(key, now), key);
    }, 500);
});

test('fuzz: odd urls and names never break path handling or exclusions', () => {
    forAll('paths', random => {
        const url = `file://${random.string(ALPHABETS.everything + '%', 40)}`;
        const name = random.string(ALPHABETS.everything, 20);
        assertEquals(typeof pathOfUrl(url), 'string');
        assertEquals(typeof displayFolder(url, '/home/me'), 'string');
        assertEquals(typeof isExcluded(url, [random.string(ALPHABETS.everything, 6), 'node_modules', '~/x/'], '/home/me'), 'boolean');
        assertEquals(typeof isExcludedType(name, [random.string(ALPHABETS.everything, 4), '.tmp']), 'boolean');
    });
});

test('fuzz: index rows of any shape become safe results', () => {
    forAll('rowsToResults', random => {
        const rows = Array.from({length: random.int(0, 8)}, () => ({
            url: random.chance(0.1) ? '' : `file:///${random.string(ALPHABETS.everything, 20)}`,
            name: random.chance(0.1) ? '' : random.string(ALPHABETS.everything, 20),
            modified: random.string(ALPHABETS.ascii, 6),
            rank: random.pick([0, 1, random.next() * 50, 1e-9]),
        }));
        const results = rowsToResults(rows, {home: '/home/me', excludedFolders: ['node_modules'], excludedTypes: ['tmp']});
        const ids = new Set(results.map(result => result.id));
        assertEquals(ids.size, results.length, 'duplicate ids');
        for (const result of results) {
            assert(result.providerScore >= 0 && result.providerScore <= 1, `relevance ${result.providerScore}`);
            assert(result.title !== '' && result.id !== '', 'a result without title or id');
            assert(!isExcluded(result.id, [], '/home/me'), 'a hidden file was kept');
        }
    });
});

test('fuzz: merging results keeps its promises for any mix of providers and scores', () => {
    forAll('mergeResults', random => {
        const entries = Array.from({length: random.int(0, 4)}, (_, index) => ({
            provider: {id: `p${index}`, name: `P${index}`, priority: random.int(0, 5), maxResults: random.int(1, 6)},
            scored: Array.from({length: random.int(0, 8)}, (_unused, n) => ({
                result: {id: random.chance(0.2) ? 'same' : `r${n}`, title: random.string(ALPHABETS.words, 10) || 'x', dedupeKey: random.chance(0.3) ? 'k' : undefined},
                final: random.next() * 1.4,
                ranges: [],
            })),
        }));
        const maxTotal = random.int(1, 12);
        const merged = mergeResults(entries, {maxTotal, topHit: random.chance(0.7)});
        const keys = merged.items.map(item => item.key);
        assertEquals(new Set(keys).size, keys.length, 'duplicate keys');
        assert(merged.items.length <= maxTotal, 'cap exceeded');
        if (merged.topHit) {
            for (const section of merged.sections)
                assert(!section.items.includes(merged.topHit), 'the top hit is also in a section');
        }
        const chosen = nextSelection(random.pick([null, 'gone', keys[0] ?? null]), merged.items, random.chance(0.5));
        assert(chosen === null || keys.includes(chosen), 'selection outside the list');
        const jumped = jumpSection(merged, random.pick([null, 'gone', keys[0] ?? null]), random.pick([1, -1]));
        assert(jumped === null || keys.includes(jumped), 'a section jump outside the list');
    });
});

test('fuzz: a corrupt or hostile searches file never breaks loading', () => {
    forAll('QueryHistory.from', random => {
        const data = random.chance(0.5)
            ? randomJson(random)
            : {queries: Array.from({length: random.int(0, 40)}, () => (random.chance(0.8)
                ? random.string(ALPHABETS.everything, random.chance(0.05) ? 300 : 12)
                : randomJson(random)))};
        const entries = QueryHistory.from(data).entries;
        assert(entries.length <= MAX_QUERIES, 'too many searches');
        const seen = new Set();
        for (const entry of entries) {
            assert(typeof entry === 'string' && entry !== '' && entry.length <= MAX_QUERY_CHARS, `bad entry ${JSON.stringify(entry)}`);
            assert(!/\p{Cc}/u.test(entry), `control character kept in ${JSON.stringify(entry)}`);
            for (const code of [0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069])
                assert(!entry.includes(String.fromCodePoint(code)), `U+${code.toString(16)} kept in ${JSON.stringify(entry)}`);
            assert(entry === entry.trim() && !/\s\s/.test(entry), `untidy spacing in ${JSON.stringify(entry)}`);
            assert(!seen.has(entry.toLowerCase()), `duplicate ${JSON.stringify(entry)}`);
            seen.add(entry.toLowerCase());
        }
    });
});

test('fuzz: the searches stay bounded, unique, and survive a save and a reload', () => {
    forAll('QueryHistory.record', random => {
        const history = new QueryHistory();
        for (let n = random.int(0, 80); n > 0; n--)
            history.record(random.chance(0.2) ? random.string(ALPHABETS.everything, 20) : `q${random.int(0, 30)}`);
        assert(history.size <= MAX_QUERIES, 'too many searches');
        const copy = QueryHistory.from(JSON.parse(JSON.stringify(history.serialize())));
        assertEquals(copy.entries, history.entries);
    });
});

test('fuzz: whatever the arrows do, the cursor stays inside the searches', () => {
    forAll('HistoryCursor', random => {
        const cursor = new HistoryCursor();
        let entries = Array.from({length: random.int(0, 6)}, (_, n) => `e${n}`);
        for (let step = random.int(1, 30); step > 0; step--) {
            const action = random.int(0, 4);
            if (action === 0) {
                const text = cursor.older(entries);
                assert(text === null ? entries.length === 0 : entries.includes(text), `older gave ${text}`);
            } else if (action === 1) {
                const text = cursor.newer(entries);
                assert(text === null || text === '' || entries.includes(text), `newer gave ${text}`);
            } else if (action === 2) {
                cursor.reset();
            } else if (action === 3) {
                entries = entries.slice(0, random.int(0, entries.length));
            }
            const where = cursor.where(entries);
            assert(where === null || (where.position >= 1 && where.position <= where.total && where.total === entries.length),
                `position ${JSON.stringify(where)} outside ${entries.length} entries`);
            assert(where === null || cursor.active, 'a position with an inactive cursor');
        }
    });
});

test('fuzz: whatever a source hands over as actions, only well-formed, bounded, clean ones come out', () => {
    forAll('cleanActions', random => {
        const raw = random.chance(0.1)
            ? randomJson(random)
            : Array.from({length: random.int(0, 40)}, () => (random.chance(0.8)
                ? {
                    id: random.chance(0.9) ? random.string(ALPHABETS.ascii, random.int(0, 8)) : randomJson(random),
                    label: random.chance(0.9) ? random.string(ALPHABETS.everything, random.int(0, 30)) : randomJson(random),
                    hint: random.chance(0.3) ? random.string(ALPHABETS.everything, 8) : undefined,
                    copy: random.chance(0.3) ? random.string(ALPHABETS.everything, random.chance(0.05) ? MAX_COPY_CHARS + 5 : 20) : randomJson(random),
                    submenu: random.chance(0.3) ? random.pick([true, false, 1, 'yes', null]) : undefined,
                    confirmation: random.chance(0.3) ? random.string(ALPHABETS.everything, 12) : undefined,
                }
                : randomJson(random)));
        const actions = cleanActions(raw);
        assert(actions.length <= MAX_ACTIONS, 'too many actions');
        const ids = new Set();
        for (const action of actions) {
            assert(typeof action.id === 'string' && action.id !== '' && !ids.has(action.id), `bad id ${JSON.stringify(action.id)}`);
            ids.add(action.id);
            assert(typeof action.label === 'string' && action.label !== '' && !/\p{Cc}/u.test(action.label), `bad label ${JSON.stringify(action.label)}`);
            assert(!('submenu' in action) || action.submenu === true, 'a submenu that is not exactly true');
            assert(!('copy' in action) || (typeof action.copy === 'string' && action.copy !== '' && action.copy.length <= MAX_COPY_CHARS), 'bad copy text');
        }
    });
});

test('fuzz: whatever is done to the menu, the highlight stays on an action of the level shown', () => {
    forAll('ActionMenu', random => {
        const menu = new ActionMenu();
        const actions = n => Array.from({length: n}, (_, i) => ({id: `a${i}`, label: `A${i}`}));
        for (let step = random.int(1, 40); step > 0; step--) {
            switch (random.int(0, 6)) {
            case 0: menu.open('t', random.chance(0.2) ? [] : actions(random.int(1, 5))); break;
            case 1: menu.push('s', random.chance(0.2) ? [] : actions(random.int(1, 5))); break;
            case 2: menu.back(); break;
            case 3: menu.move(random.int(-9, 9)); break;
            case 4: menu.select(random.int(-2, 8)); break;
            default: if (random.chance(0.1)) menu.close();
            }
            assert(menu.depth <= 2 || menu.depth >= 0, 'depth');
            if (menu.isOpen) {
                assert(menu.index >= 0 && menu.index < menu.actions.length, `index ${menu.index} outside ${menu.actions.length} actions`);
                assert(menu.selected === menu.actions[menu.index] || JSON.stringify(menu.selected) === JSON.stringify(menu.actions[menu.index]), 'selected is not the indexed action');
            } else {
                assert(menu.selected === null && menu.index === -1, 'a closed menu has no highlight');
            }
        }
    });
});

test('fuzz: whatever is typed, the calculator never throws and only gives clean answers', () => {
    const pieces = ['1', '2', '35', '0', '1,5', '.5', '1 000', ' ', '+', '-', '*', '/', '^', '%', '(', ')', 'pi', 'e', 'sqrt', 'abs', 'km', 'm', 'kg', '°C', 'en', 'to', 'mod', 'de', '→', '×', '÷', '−', 'foo', 'Go', 'To'];
    forAll('evaluateQuery', random => {
        const text = random.chance(0.3)
            ? random.string(ALPHABETS.everything, random.int(0, 60))
            : Array.from({length: random.int(0, 25)}, () => random.pick(pieces)).join(random.chance(0.5) ? ' ' : '');
        const outcome = evaluateQuery(text, {decimal: random.pick(['.', ','])});
        if (outcome === null)
            return;
        assert(text.length <= MAX_INPUT, 'an answer for a text that is too long');
        assert(outcome.kind === 'calc' || outcome.kind === 'convert', `kind ${outcome.kind}`);
        assert(typeof outcome.result === 'string' && outcome.result !== '' && !/(NaN|Infinity|undefined)/.test(outcome.result), `bad result ${JSON.stringify(outcome.result)}`);
        assert(!/\p{Cc}/u.test(outcome.result + outcome.full + outcome.text), 'a control character in the answer');
        assert(outcome.full.includes(outcome.result), 'the whole calculation does not hold the result');
        assert(outcome.text === outcome.text.trim() && !/\s\s/.test(outcome.text), 'untidy text');
    });
});

test('fuzz: deeply nested or very long input is refused or answered, never a crash', () => {
    forAll('evaluateQuery depth', random => {
        const open = random.pick(['(', 'sqrt(', '-', '--', '2^']);
        const text = `${open.repeat(random.int(1, 300))}1${random.chance(0.5) ? ')'.repeat(random.int(0, 300)) : ''}`;
        evaluateQuery(text);
        evaluateQuery(`1${random.pick([' + 1', '*1', '^1'])}`.repeat(random.int(1, 400)));
    });
});

test('fuzz: a number written in the usual ways is read as the number it is', () => {
    forAll('evaluateQuery numbers', random => {
        const whole = random.int(0, 999999);
        const fraction = random.int(0, 999);
        const mark = random.pick(['.', ',']);
        const text = `${whole}${mark}${String(fraction).padStart(3, '0')} + 0`;
        const outcome = evaluateQuery(text, {decimal: '.'});
        assertEquals(outcome?.result, String(Number(`${whole}.${String(fraction).padStart(3, '0')}`)), text);
    });
});
