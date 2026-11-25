// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {createMatcher} from '../../src/core/matching.js';
import {scoreResult} from '../../src/core/scoring.js';
import {assert, assertEquals, test} from '../harness.js';
import {ALPHABETS, forAll} from './random.js';

function checkMatch(match, textLength) {
    assert(match.score > 0 && match.score <= 1, `score ${match.score} out of (0, 1]`);
    let previousEnd = -1;
    for (const [start, end] of match.ranges) {
        assert(start >= 0 && end <= textLength && start < end, `range [${start}, ${end}) outside the text`);
        assert(start >= previousEnd, 'ranges overlap or are unsorted');
        previousEnd = end;
    }
}

test('fuzz: matching never throws and always gives valid scores and ranges', () => {
    forAll('matching', random => {
        const query = random.string(random.pick(Object.values(ALPHABETS)), 12);
        const text = random.string(random.pick(Object.values(ALPHABETS)), 40);
        const match = createMatcher(query).match(text);
        if (match)
            checkMatch(match, text.length);
    });
});

test('fuzz: letters taken in order from a text (a fuzzy query) give valid ranges, and the case is really exercised', () => {
    let matched = 0;
    forAll('subsequence', random => {
        const text = random.string(ALPHABETS.words, 40);
        const letters = Array.from(text).filter(c => c !== ' ' && random.chance(0.3)).slice(0, 5);
        const query = letters.join('');
        if (query === '')
            return;
        const match = createMatcher(query).match(text);
        if (match) {
            matched++;
            checkMatch(match, text.length);
        }
    });
    assert(matched > 300, `the generator reached the fuzzy path too rarely (${matched} matches)`);
});

test('fuzz: any piece of a text matches that text', () => {
    forAll('substring', random => {
        const text = random.string(ALPHABETS.everything, 40);
        const from = random.int(0, text.length);
        const piece = text.slice(from, from + random.int(1, 8));
        if (piece.trim() === '')
            return;
        const match = createMatcher(piece).match(text);
        // A piece may be only separators, which no query keeps; otherwise it must be found.
        if (createMatcher(piece).isEmpty)
            return;
        assert(match !== null, `${JSON.stringify(piece)} not found in ${JSON.stringify(text)}`);
        checkMatch(match, text.length);
    });
});

test('fuzz: a text always matches itself with the best score', () => {
    forAll('self', random => {
        const text = random.string(ALPHABETS.words, 20).trim().replace(/\s+/g, ' ');
        if (text === '')
            return;
        assertEquals(createMatcher(text).match(text).score, 1, JSON.stringify(text));
    });
});

test('fuzz: scoring a result never throws, whatever the fields', () => {
    forAll('scoring', random => {
        const matcher = createMatcher(random.string(ALPHABETS.everything, 10));
        const fields = [];
        for (let n = random.int(0, 4); n > 0; n--)
            fields.push({text: random.string(ALPHABETS.everything, 20), weight: random.next() * 2});
        const result = {
            id: random.string(ALPHABETS.ascii, 8),
            title: random.string(ALPHABETS.everything, 20),
            matchFields: random.chance(0.5) ? fields : undefined,
            providerScore: random.chance(0.3) ? random.next() * 3 - 1 : undefined,
        };
        const scored = scoreResult(result, matcher, null, 1_700_000_000_000);
        if (scored) {
            assert(Number.isFinite(scored.final) && scored.final > 0, `final ${scored.final}`);
            for (const [start, end] of scored.ranges)
                assert(start >= 0 && end <= result.title.length, 'highlight outside the title');
        }
    });
});
