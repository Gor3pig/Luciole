import {
    buildFtsTerms, displayFolder, isExcluded, isExcludedType, parentUrl, pathOfUrl, rowsToResults,
} from '../src/providers/files-query.js';
import {assert, assertEquals, test} from './harness.js';

const HOME = '/home/me';

test('every word becomes a prefix', () => {
    assertEquals(buildFtsTerms('annual rep'), 'annual* rep*');
    assertEquals(buildFtsTerms('  Facture   2026 '), 'Facture* 2026*');
});

test('query operators, quotes and wildcards typed by the user are never passed on', () => {
    assertEquals(buildFtsTerms('"report" OR -draft*'), 'report* OR* draft*');
    assertEquals(buildFtsTerms('a* ) ; DROP "x" \' --'), 'a* DROP* x*');
    for (const hostile of ['"', '\'', '*', ')', '(', ':', '^', '\\', 'NEAR(a b)', 'a OR b AND c NOT d']) {
        const terms = buildFtsTerms(`${hostile} test`);
        assert(terms === null || /^[\p{L}\p{N}* ]+$/u.test(terms), `unsafe characters survived: ${terms}`);
    }
});

test('accents are kept and digits count as words', () => {
    assertEquals(buildFtsTerms('éditeur'), 'éditeur*');
    assertEquals(buildFtsTerms('2026'), '2026*');
});

test('nothing worth searching gives null', () => {
    assertEquals(buildFtsTerms(''), null);
    assertEquals(buildFtsTerms('   '), null);
    assertEquals(buildFtsTerms('"" ** --'), null);
    assertEquals(buildFtsTerms('a'), null, 'one letter matches almost everything');
    assertEquals(buildFtsTerms('a b c'), null);
});

test('a short word is fine next to a longer one, and the number of words is capped', () => {
    assertEquals(buildFtsTerms('a report'), 'a* report*');
    assertEquals(buildFtsTerms('one two three four five six seven'), 'one* two* three* four* five*');
});

test('pathOfUrl decodes the url and tolerates a bad escape', () => {
    assertEquals(pathOfUrl('file:///home/me/a%20b.odt'), '/home/me/a b.odt');
    assertEquals(pathOfUrl('file:///home/me/100%.txt'), '/home/me/100%.txt');
});

test('displayFolder shows the folder, with the home directory as ~', () => {
    assertEquals(displayFolder('file:///home/me/Documents/a.odt', HOME), '~/Documents');
    assertEquals(displayFolder('file:///home/me/a.odt', HOME), '~');
    assertEquals(displayFolder('file:///home/meagain/a.odt', HOME), '/home/meagain', 'a longer name is not the home');
    assertEquals(displayFolder('file:///var/log/a.log', HOME), '/var/log');
    assertEquals(displayFolder('file:///a.txt', HOME), '/');
    assertEquals(displayFolder('file:///home/me/Mes%20Docs/a.odt', HOME), '~/Mes Docs');
});

test('parentUrl is the url of the containing folder', () => {
    assertEquals(parentUrl('file:///home/me/Documents/a.odt'), 'file:///home/me/Documents');
    assertEquals(parentUrl('file:///a.txt'), 'file://');
});

test('hidden files and folders are always excluded', () => {
    assert(isExcluded('file:///home/me/.cache/x.txt', [], HOME), 'hidden folder');
    assert(isExcluded('file:///home/me/.bashrc', [], HOME), 'hidden file');
    assert(!isExcluded('file:///home/me/Documents/a.txt', [], HOME), 'normal file');
    assert(!isExcluded('file:///home/me/a.b.txt', [], HOME), 'a dot inside a name is not hidden');
});

test('a rule without a slash excludes that name anywhere', () => {
    const rules = ['node_modules'];
    assert(isExcluded('file:///home/me/p/node_modules/x/LICENSE', rules, HOME), 'folder anywhere');
    assert(!isExcluded('file:///home/me/p/my_node_modules/LICENSE', rules, HOME), 'a longer name is not matched');
});

test('a rule with a slash excludes that folder and everything below it', () => {
    const rules = ['~/Private', '/data/backup/'];
    assert(isExcluded('file:///home/me/Private/a.txt', rules, HOME), '~ expanded');
    assert(isExcluded('file:///home/me/Private', rules, HOME), 'the folder itself');
    assert(isExcluded('file:///data/backup/2026/a.txt', rules, HOME), 'absolute, trailing slash ignored');
    assert(!isExcluded('file:///home/me/PrivateNot/a.txt', rules, HOME), 'a longer name is not matched');
    assert(!isExcluded('file:///home/me/Docs/Private/a.txt', rules, HOME), 'only at that path');
});

test('empty rules are ignored', () => {
    assert(!isExcluded('file:///home/me/a.txt', ['', ''], HOME), 'no effect');
});

test('excluded types match extensions in any spelling and any case', () => {
    assert(isExcludedType('Build.TMP', ['.tmp']), '.tmp');
    assert(isExcludedType('a.o', ['*.o']), '*.o');
    assert(isExcludedType('server.log', ['log']), 'log');
    assert(!isExcludedType('catalog', ['log']), 'a suffix that is not an extension');
    assert(!isExcludedType('a.txt', ['', '.']), 'empty types');
});

const row = (name, rank, folder = '/home/me/Documents') => ({url: `file://${folder}/${name}`, name, rank});

test('rows become results with a relevance rescaled to the best row', () => {
    const results = rowsToResults([row('a.odt', 8), row('b.odt', 4)], {home: HOME});
    assertEquals(results.map(r => r.providerScore), [1, 0.5]);
    assertEquals(results[0], {
        id: 'file:///home/me/Documents/a.odt', title: 'a.odt', subtitle: '~/Documents', icon: undefined,
        providerScore: 1, frecencyKey: 'files:file:///home/me/Documents/a.odt',
        dedupeKey: 'file:///home/me/Documents/a.odt',
        data: {url: 'file:///home/me/Documents/a.odt', parentUrl: 'file:///home/me/Documents'},
    });
});

test('excluded rows and rows without a url or a name are dropped', () => {
    const rows = [row('keep.odt', 5), row('x.tmp', 5), row('hidden', 5, '/home/me/.cache'), row('lib.js', 5, '/home/me/p/node_modules'), {url: '', name: 'n', rank: 1}, {url: 'file:///a', name: '', rank: 1}];
    const results = rowsToResults(rows, {home: HOME, excludedFolders: ['node_modules'], excludedTypes: ['.tmp']});
    assertEquals(results.map(r => r.title), ['keep.odt']);
});

test('the same file twice is kept once', () => {
    assertEquals(rowsToResults([row('a.odt', 5), row('a.odt', 3)], {home: HOME}).length, 1);
});

test('the relevance of every row being zero does not divide by zero', () => {
    assertEquals(rowsToResults([row('a.odt', 0)], {home: HOME})[0].providerScore, 1);
});

test('the icon comes from the given function, called with the file name', () => {
    const results = rowsToResults([row('a.odt', 1)], {home: HOME, iconFor: name => `icon-of-${name}`});
    assertEquals(results[0].icon, 'icon-of-a.odt');
});

test('no rows give no results', () => {
    assertEquals(rowsToResults([], {home: HOME}), []);
});
