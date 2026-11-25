import {Frecency} from '../src/core/frecency.js';
import {createMatcher} from '../src/core/matching.js';
import {SCORING, scoreForEmptyQuery, scoreResult} from '../src/core/scoring.js';
import {assert, assertEquals, test} from './harness.js';

const NOW = 1_700_000_000_000;
const matcher = query => createMatcher(query);
const frecencyWith = (key, uses) => {
    const f = new Frecency();
    for (let i = 0; i < uses; i++)
        f.record(key, NOW);
    return f;
};

test('an empty query scores nothing', () => {
    assertEquals(scoreResult({id: '1', title: 'Firefox'}, matcher(''), null, NOW), null);
});

test('a result that does not match is dropped', () => {
    assertEquals(scoreResult({id: '1', title: 'Firefox'}, matcher('zq'), null, NOW), null);
});

test('a very weak match is dropped (below the minimum)', () => {
    const weak = {id: '1', title: 'Firefox', matchFields: [{text: 'Firefox', weight: 0.1}]};
    assertEquals(scoreResult(weak, matcher('fi'), null, NOW), null);
});

test('the best of the match fields counts, each with its weight', () => {
    const app = {
        id: '1',
        title: 'Navigateur',
        matchFields: ['Navigateur', {text: 'firefox', weight: 0.5}],
    };
    const scored = scoreResult(app, matcher('fire'), null, NOW);
    assert(scored !== null, 'matched through the keyword');
    assertEquals(scored.text, 0.92 * 0.5);
});

test('highlight ranges only come from the title', () => {
    const app = {id: '1', title: 'Navigateur', matchFields: ['Navigateur', 'firefox']};
    assertEquals(scoreResult(app, matcher('fire'), null, NOW).ranges, []);
    const direct = {id: '2', title: 'Firefox'};
    assertEquals(scoreResult(direct, matcher('fire'), null, NOW).ranges, [[0, 4]]);
});

test('frecency raises a good match, by at most the cap', () => {
    const r = {id: '1', title: 'Firefox', frecencyKey: 'apps:ff'};
    const plain = scoreResult(r, matcher('fire'), null, NOW);
    const boosted = scoreResult(r, matcher('fire'), frecencyWith('apps:ff', 50), NOW);
    assert(boosted.final > plain.final, 'boosted');
    assert(boosted.bonus <= SCORING.FRECENCY_MAX, `bonus ${boosted.bonus} within the cap`);
    assertEquals(boosted.text, plain.text);
});

test('frecency never lifts a weak match', () => {
    const r = {id: '1', title: 'Firefox', frecencyKey: 'apps:ff', matchFields: [{text: 'Firefox', weight: 0.5}]};
    const weak = scoreResult(r, matcher('ff'), frecencyWith('apps:ff', 50), NOW);
    assert(weak !== null && weak.text < SCORING.FRECENCY_MIN_TEXT, `precondition: weak but kept (${weak?.text})`);
    assertEquals(weak.bonus, 0);
});

test('a heavily used weak match does not beat a good match', () => {
    const popular = {id: '1', title: 'Firefox', frecencyKey: 'a'};
    const good = {id: '2', title: 'Terminal', frecencyKey: 'b'};
    const f = frecencyWith('a', 500);
    const m = matcher('term');
    const goodScore = scoreResult(good, m, f, NOW);
    const popularScore = scoreResult({...popular, title: 'Xterminator games'}, m, f, NOW);
    assert(goodScore.final > popularScore.final, 'good match first');
});

test('a result without a frecency key gets no bonus', () => {
    const scored = scoreResult({id: '1', title: 'Firefox'}, matcher('fire'), frecencyWith('x', 9), NOW);
    assertEquals(scored.bonus, 0);
});

test('providerScore is mixed with the name match', () => {
    const file = {id: '1', title: 'report.odt', providerScore: 1};
    const named = scoreResult(file, matcher('report'), null, NOW);
    assertEquals(named.text, 0.5 * 1 + 0.5 * 0.92);
    const contentOnly = scoreResult({id: '2', title: 'notes.odt', providerScore: 0.8}, matcher('invoice'), null, NOW);
    assertEquals(contentOnly.text, 0.5 * 0.8);
});

test('providerScore is clamped to 0..1', () => {
    const high = scoreResult({id: '1', title: 'x', providerScore: 7}, matcher('nomatch'), null, NOW);
    assertEquals(high.text, 0.5);
});

test('a provider score too low is dropped', () => {
    assertEquals(scoreResult({id: '1', title: 'x', providerScore: 0.1}, matcher('zz'), null, NOW), null);
});

test('for an empty query only frecency ranks a result', () => {
    const r = {id: '1', title: 'Firefox', frecencyKey: 'apps:ff'};
    assertEquals(scoreForEmptyQuery(r, null, NOW).final, 0);
    const scored = scoreForEmptyQuery(r, frecencyWith('apps:ff', 3), NOW);
    assert(scored.final > 0 && scored.text === 0, 'frecency only');
});
