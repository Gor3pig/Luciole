import {jumpSection, mergeResults, nextSelection} from '../src/core/merge.js';
import {assert, assertEquals, test} from './harness.js';

const scored = (id, title, final, extra = {}) => ({result: {id, title, ...extra}, final, ranges: []});
const provider = (id, priority, extra = {}) => ({id, name: id.toUpperCase(), priority, ...extra});
const titles = items => items.map(item => item.result.title);

test('items are ordered best first inside a section', () => {
    const merged = mergeResults([{provider: provider('apps', 1), scored: [scored('1', 'B', 0.3), scored('2', 'A', 0.5)]}], {topHit: false});
    assertEquals(titles(merged.sections[0].items), ['A', 'B']);
});

test('equal scores are ordered by shorter title, then alphabetically', () => {
    const merged = mergeResults([{provider: provider('apps', 1), scored: [
        scored('1', 'Zed', 0.5), scored('2', 'Longer name', 0.5), scored('3', 'Abc', 0.5),
    ]}], {topHit: false});
    assertEquals(titles(merged.sections[0].items), ['Abc', 'Zed', 'Longer name']);
});

test('sections follow the provider priority, whatever the order of arrival', () => {
    const merged = mergeResults([
        {provider: provider('files', 2), scored: [scored('f', 'file', 0.4)]},
        {provider: provider('apps', 1), scored: [scored('a', 'app', 0.4)]},
    ], {topHit: false});
    assertEquals(merged.sections.map(s => s.providerId), ['apps', 'files']);
    assertEquals(merged.sections[0].title, 'APPS');
});

test('the best result above the threshold becomes the top hit and leaves its section', () => {
    const merged = mergeResults([
        {provider: provider('apps', 1), scored: [scored('1', 'Firefox', 0.9), scored('2', 'Files', 0.6)]},
        {provider: provider('files', 2), scored: [scored('3', 'notes', 0.7)]},
    ]);
    assertEquals(merged.topHit.result.title, 'Firefox');
    assertEquals(titles(merged.sections[0].items), ['Files']);
    assertEquals(titles(merged.items), ['Firefox', 'Files', 'notes']);
});

test('the top hit can come from any provider', () => {
    const merged = mergeResults([
        {provider: provider('apps', 1), scored: [scored('1', 'App', 0.6)]},
        {provider: provider('files', 2), scored: [scored('2', 'Doc', 0.95)]},
    ]);
    assertEquals(merged.topHit.result.title, 'Doc');
});

test('no top hit below the threshold, or when disabled', () => {
    const entries = [{provider: provider('apps', 1), scored: [scored('1', 'Weak', 0.4)]}];
    assertEquals(mergeResults(entries).topHit, null);
    const strong = [{provider: provider('apps', 1), scored: [scored('1', 'Strong', 0.95)]}];
    assertEquals(mergeResults(strong, {topHit: false}).topHit, null);
    assertEquals(mergeResults(strong, {topHitMin: 0.99}).topHit, null);
});

test('a provider cannot show more than its limit', () => {
    const many = Array.from({length: 6}, (_, i) => scored(`${i}`, `T${i}`, 0.5 - i * 0.01));
    const merged = mergeResults([{provider: provider('apps', 1, {maxResults: 3}), scored: many}], {topHit: false});
    assertEquals(merged.sections[0].items.length, 3);
});

test('the overall cap drops the last sections first', () => {
    const merged = mergeResults([
        {provider: provider('apps', 1), scored: [scored('1', 'A1', 0.5), scored('2', 'A2', 0.4)]},
        {provider: provider('files', 2), scored: [scored('3', 'F1', 0.6)]},
    ], {topHit: false, maxTotal: 2});
    assertEquals(titles(merged.items), ['A1', 'A2']);
    assertEquals(merged.sections.length, 1);
});

test('the overall cap counts the top hit', () => {
    const merged = mergeResults([
        {provider: provider('apps', 1), scored: [scored('1', 'Top', 0.9), scored('2', 'B', 0.5), scored('3', 'C', 0.4)]},
    ], {maxTotal: 2});
    assertEquals(titles(merged.items), ['Top', 'B']);
});

test('the same result twice keeps the better score', () => {
    const merged = mergeResults([
        {provider: provider('apps', 1), scored: [scored('1', 'Firefox', 0.4), scored('1', 'Firefox', 0.7)]},
    ], {topHit: false});
    assertEquals(merged.items.length, 1);
    assertEquals(merged.items[0].final, 0.7);
});

test('the same thing offered by two providers is shown once, with the better score', () => {
    const merged = mergeResults([
        {provider: provider('apps', 1), scored: [scored('a', 'Notes', 0.6, {dedupeKey: 'notes'})]},
        {provider: provider('files', 2), scored: [scored('f', 'Notes', 0.8, {dedupeKey: 'notes'})]},
    ], {topHit: false});
    assertEquals(merged.items.length, 1);
    assertEquals(merged.items[0].providerId, 'files');
});

test('a provider with no results gives no section', () => {
    const merged = mergeResults([
        {provider: provider('apps', 1), scored: []},
        {provider: provider('files', 2), scored: [scored('1', 'x', 0.5)]},
    ], {topHit: false});
    assertEquals(merged.sections.map(s => s.providerId), ['files']);
});

test('nothing at all gives an empty list', () => {
    const merged = mergeResults([]);
    assertEquals(merged, {topHit: null, sections: [], items: []});
});

test('item keys combine provider and result ids', () => {
    const merged = mergeResults([{provider: provider('apps', 1), scored: [scored('x', 'X', 0.5)]}], {topHit: false});
    assertEquals(merged.items[0].key, 'apps:x');
});

test('selection follows the top item until the user moves it', () => {
    const items = [{key: 'a'}, {key: 'b'}];
    assertEquals(nextSelection(null, items, false), 'a');
    assertEquals(nextSelection('b', items, false), 'a');
});

test('selection stays on the chosen item once the user navigated', () => {
    assertEquals(nextSelection('b', [{key: 'a'}, {key: 'b'}], true), 'b');
    assertEquals(nextSelection('gone', [{key: 'a'}, {key: 'b'}], true), 'a');
});

test('selection is null for an empty list', () => {
    assert(nextSelection('a', [], true) === null, 'null');
});

const threeGroups = () => mergeResults([
    {provider: provider('apps', 1), scored: [scored('1', 'Top', 0.9), scored('2', 'A2', 0.5), scored('3', 'A3', 0.4)]},
    {provider: provider('files', 2), scored: [scored('4', 'F1', 0.45), scored('5', 'F2', 0.3)]},
]);

test('Tab goes to the first item of the next section, then wraps around', () => {
    const merged = threeGroups();
    assertEquals(merged.items.map(i => i.key), ['apps:1', 'apps:2', 'apps:3', 'files:4', 'files:5']);
    assertEquals(jumpSection(merged, 'apps:1', 1), 'apps:2', 'from the top hit to the applications');
    assertEquals(jumpSection(merged, 'apps:3', 1), 'files:4', 'from the end of a section to the next one');
    assertEquals(jumpSection(merged, 'files:5', 1), 'apps:1', 'wraps to the top hit');
});

test('Shift+Tab goes to the first item of the previous section, then wraps around', () => {
    const merged = threeGroups();
    assertEquals(jumpSection(merged, 'files:4', -1), 'apps:2');
    assertEquals(jumpSection(merged, 'apps:3', -1), 'apps:1', 'from the middle of a section to the one before');
    assertEquals(jumpSection(merged, 'apps:1', -1), 'files:4', 'wraps to the last section');
});

test('with a single group, Tab stays on its first item', () => {
    const merged = mergeResults([{provider: provider('apps', 1), scored: [scored('1', 'A', 0.5), scored('2', 'B', 0.4)]}], {topHit: false});
    assertEquals(jumpSection(merged, 'apps:2', 1), 'apps:1');
    assertEquals(jumpSection(merged, 'apps:1', -1), 'apps:1');
});

test('Tab without a known selection starts at the first or the last section', () => {
    const merged = threeGroups();
    assertEquals(jumpSection(merged, null, 1), 'apps:1');
    assertEquals(jumpSection(merged, 'gone', -1), 'files:4');
});

test('Tab with nothing to select gives null', () => {
    assert(jumpSection(mergeResults([]), null, 1) === null, 'null');
});
