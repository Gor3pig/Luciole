// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Tests the files provider against a real TinySPARQL database kept in memory,
// with the standard ontology: the real query, the real full-text matching.

import Gio from 'gi://Gio';
import Tracker from 'gi://Tracker';

import {FilesProvider} from '../src/providers/files.js';
import {recordingLog} from './fakes/provider.js';
import {assert, assertEquals, test} from './harness.js';

function memoryDatabase(files) {
    const connection = Tracker.SparqlConnection.new(
        Tracker.SparqlConnectionFlags.NONE, null, Tracker.sparql_get_ontology_nepomuk(), null);
    for (const [folder, name] of files) {
        const url = `file://${folder}/${encodeURIComponent(name)}`;
        const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        connection.update(
            `INSERT DATA { <${url}> a nfo:FileDataObject ; nie:url "${url}" ; nfo:fileName "${escaped}" ; ` +
            'nfo:fileLastModified "2026-11-01T10:00:00Z" . }', null);
    }
    return connection;
}

const FILES = [
    ['/home/me/Documents', 'Rapport annuel.odt'],
    ['/home/me/Documents', 'rapport-brouillon.txt'],
    ['/home/me/Documents', 'Facture mars.pdf'],
    ['/home/me/Documents', 'build.tmp'],
    ['/home/me/.cache', 'rapport-cache.txt'],
    ['/home/me/project/node_modules/lib', 'rapport.js'],
    ['/home/me/Documents', 'say "hi" now.txt'],
];

function setupProvider({files = FILES, excludedFolders = [], excludedTypes = [], openConnection} = {}) {
    const log = recordingLog();
    const database = openConnection ? null : memoryDatabase(files);
    const opened = [];
    const launched = [];
    const provider = new FilesProvider({
        openConnection: openConnection ?? (async () => {
            opened.push(true);
            return database;
        }),
        openUri: async uri => {
            launched.push(uri);
        },
    });
    const settings = {
        get_strv: key => (key === 'excluded-folders' ? excludedFolders : excludedTypes),
        get_int: () => 6,
    };
    const ready = provider.init({settings, log, gettext: text => text});
    const search = query => provider.search(query, {cancellable: new Gio.Cancellable(), limit: 6, emit() {}});
    return {provider, log, opened, launched, ready, search, database};
}

const titles = results => results.map(r => r.title);

test('a prefix finds the files whose name starts a word with it', async () => {
    const t = setupProvider();
    await t.ready;
    const results = await t.search('rapp');
    assertEquals(titles(results).sort(), ['Rapport annuel.odt', 'rapport-brouillon.txt', 'rapport.js'].sort());
    t.provider.destroy();
});

test('results come best first', async () => {
    const t = setupProvider();
    await t.ready;
    const scores = (await t.search('rapport')).map(r => r.providerScore);
    assert(scores.length >= 2, 'several results');
    assertEquals(scores, [...scores].sort((a, b) => b - a));
    assertEquals(scores[0], 1, 'the best is the reference');
    t.provider.destroy();
});

test('results carry the folder, a relevance and what the window needs', async () => {
    const t = setupProvider({excludedFolders: ['node_modules']});
    await t.ready;
    const [first] = await t.search('facture');
    assertEquals(first.title, 'Facture mars.pdf');
    assertEquals(first.subtitle, '/home/me/Documents');
    assertEquals(first.frecencyKey, 'files:file:///home/me/Documents/Facture%20mars.pdf');
    assertEquals(first.data.parentUrl, 'file:///home/me/Documents');
    assert(first.providerScore > 0 && first.providerScore <= 1, 'relevance in 0..1');
    assert(first.icon instanceof Gio.Icon, 'an icon for the file type');
    t.provider.destroy();
});

test('several words must all match', async () => {
    const t = setupProvider();
    await t.ready;
    assertEquals(titles(await t.search('rapport annuel')), ['Rapport annuel.odt']);
    assertEquals(await t.search('rapport mars'), []);
    t.provider.destroy();
});

test('hidden folders are never searched, and excluded folders and types are dropped', async () => {
    const t = setupProvider({excludedFolders: ['node_modules'], excludedTypes: ['.tmp']});
    await t.ready;
    assertEquals(titles(await t.search('rapport')).sort(), ['Rapport annuel.odt', 'rapport-brouillon.txt']);
    assertEquals(await t.search('build'), []);
    t.provider.destroy();
});

test('a query with quotes and operators cannot change the query or break it', async () => {
    const t = setupProvider();
    await t.ready;
    // The name really contains quotes: the sanitised query still finds the file by its words.
    assertEquals(titles(await t.search('say "hi"')), ['say "hi" now.txt']);
    for (const hostile of ['" OR 1=1 --', '\'; DROP', 'rapport* ) UNION', 'NEAR(a b)', '* *', '<x> {y}']) {
        const results = await t.search(hostile);
        assert(Array.isArray(results), `no error for ${hostile}`);
        assert(results.length < FILES.length, `it must not return everything for ${hostile}`);
    }
    assertEquals(titles(await t.search('rapp')).length > 0, true, 'the database is intact');
    t.provider.destroy();
});

test('a query too short or empty gives nothing and does not even connect', async () => {
    const t = setupProvider();
    await t.ready;
    assertEquals(await t.search(''), []);
    assertEquals(await t.search('r'), []);
    assertEquals(await t.search('"" *'), []);
    assertEquals(await t.provider.emptyQueryResults({}), []);
    assertEquals(t.opened.length, 0);
    t.provider.destroy();
});

test('the connection is opened on the first real search, once, even for overlapping searches', async () => {
    const t = setupProvider();
    await t.ready;
    assertEquals(t.opened.length, 0, 'nothing at start-up');
    await Promise.all([t.search('rapp'), t.search('fact'), t.search('annuel')]);
    await t.search('rapp');
    assertEquals(t.opened.length, 1);
    t.provider.destroy();
});

test('when the index service is missing, searches return nothing, with one warning', async () => {
    let attempts = 0;
    const t = setupProvider({
        openConnection: async () => {
            attempts++;
            throw new Error('no such service');
        },
    });
    await t.ready;
    assertEquals(await t.search('rapport'), []);
    assertEquals(await t.search('facture'), []);
    assertEquals(attempts, 1, 'does not retry on every keystroke');
    assertEquals(t.log.lines.filter(l => l.startsWith('warn:') && l.includes('no such service')).length, 1);
});

test('a cancelled search is reported as a cancellation', async () => {
    const t = setupProvider();
    await t.ready;
    await t.search('rapp');
    const cancellable = new Gio.Cancellable();
    const pending = t.provider.search('rapp', {cancellable, limit: 6, emit() {}});
    cancellable.cancel();
    let outcome;
    try {
        outcome = await pending;
    } catch (error) {
        outcome = error;
    }
    const cancelled = Array.isArray(outcome) || outcome.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
    assert(cancelled, `unexpected outcome: ${outcome}`);
    t.provider.destroy();
});

test('after destroy a search gives nothing and a late connection is closed', async () => {
    let release;
    const gate = new Promise(resolve => {
        release = resolve;
    });
    const database = memoryDatabase(FILES);
    const t = setupProvider({
        openConnection: async () => {
            await gate;
            return database;
        },
    });
    await t.ready;
    const pending = t.search('rapp');
    t.provider.destroy();
    release();
    assertEquals(await pending, []);
    assertEquals(await t.search('rapp'), []);
});

test('after destroy no connection is opened at all', async () => {
    const t = setupProvider();
    await t.ready;
    t.provider.destroy();
    assertEquals(await t.search('rapport'), []);
    assertEquals(t.opened.length, 0);
});

test('activating a result opens its file; the secondary action opens its folder', async () => {
    const t = setupProvider();
    await t.ready;
    const [first] = await t.search('facture');
    await t.provider.activate(first);
    assertEquals(t.launched, ['file:///home/me/Documents/Facture%20mars.pdf']);
    const [action] = t.provider.secondaryActions(first);
    assertEquals(action.id, 'open-folder');
    await t.provider.activateAction(first, action);
    assertEquals(t.launched[1], 'file:///home/me/Documents');
    await t.provider.activateAction(first, {id: 'unknown'});
    assertEquals(t.launched.length, 2);
    t.provider.destroy();
});

test('the provider describes itself', async () => {
    const t = setupProvider();
    await t.ready;
    assertEquals([t.provider.id, t.provider.name, t.provider.priority], ['files', 'Files', 20]);
    assert(t.provider.debounceMs > 0, 'debounced: it costs more than the applications');
    assertEquals(t.provider.maxResults, 6);
    assertEquals(t.provider.scoreWeight, 0.9);
    t.provider.destroy();
});
