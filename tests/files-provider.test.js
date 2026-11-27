// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Tests the files provider against a real TinySPARQL database kept in memory,
// with the standard ontology: the real query, the real full-text matching.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Tracker from 'gi://Tracker';

import {FilesProvider, keepType} from '../src/providers/files.js';
import {recordingLog} from './fakes/provider.js';
import {assert, assertEquals, test} from './harness.js';

const nextIdle = () => new Promise(resolve => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

// A folder is listed with a trailing "/" in its name here; the index keeps it as a file whose
// content is an nfo:Folder of type inode/directory, as LocalSearch does.
function memoryDatabase(files) {
    const connection = Tracker.SparqlConnection.new(
        Tracker.SparqlConnectionFlags.NONE, null, Tracker.sparql_get_ontology_nepomuk(), null);
    for (const [folder, listed] of files) {
        const isFolder = listed.endsWith('/');
        const name = isFolder ? listed.slice(0, -1) : listed;
        const url = `file://${folder}/${encodeURIComponent(name)}`;
        const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        connection.update(
            `INSERT DATA { <${url}> a nfo:FileDataObject ; nie:url "${url}" ; nfo:fileName "${escaped}" ; ` +
            'nfo:fileLastModified "2026-11-01T10:00:00Z" . }', null);
        if (isFolder) {
            connection.update(
                `INSERT DATA { <${url}#content> a nfo:Folder ; nie:isStoredAs <${url}> ; nie:mimeType "inode/directory" . }`, null);
        }
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

function setupProvider({files = FILES, excludedFolders = [], excludedTypes = [], openConnection, missing = [], apps = [], noFileManager = false, kind = 'files'} = {}) {
    const log = recordingLog();
    const database = openConnection ? null : memoryDatabase(files);
    const opened = [];
    const launched = [];
    const shown = [];
    const provider = new FilesProvider({
        kind,
        openConnection: openConnection ?? (async () => {
            opened.push(true);
            return database;
        }),
        openUri: async uri => {
            launched.push(uri);
        },
        exists: async uri => !missing.includes(uri),
        appsFor: async () => apps.map(app => ({...app, launch: uri => launched.push(`${app.id} ${uri}`)})),
        showItem: async uri => {
            if (noFileManager)
                throw new Error('no file manager on the bus');
            shown.push(uri);
        },
    });
    const settings = {
        get_strv: key => (key === 'excluded-folders' ? excludedFolders : excludedTypes),
        get_int: () => 6,
    };
    const ready = provider.init({settings, log, gettext: text => text});
    const search = query => provider.search(query, {cancellable: new Gio.Cancellable(), limit: 6, emit() {}});
    return {provider, log, opened, launched, shown, ready, search, database};
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
    let closed = 0;
    const connection = {
        query_statement: (...args) => database.query_statement(...args),
        close_async: (cancellable, callback) => {
            closed++;
            database.close_async(cancellable, callback);
        },
    };
    const t = setupProvider({
        openConnection: async () => {
            await gate;
            return connection;
        },
    });
    await t.ready;
    const pending = t.search('rapp');
    t.provider.destroy();
    release();
    assertEquals(await pending, []);
    assertEquals(await t.search('rapp'), []);
    for (let turns = 0; turns < 3; turns++)
        await nextIdle();
    assertEquals(closed, 1, 'the connection that arrived after destroy must be closed, once');
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
    assertEquals(t.shown, ['file:///home/me/Documents/Facture%20mars.pdf'], 'the file itself, shown selected in its folder');
    assert((await failureOf(t.provider.activateAction(first, {id: 'unknown'})))?.includes('unknown action'), 'an unknown action must be refused');
    assertEquals(t.launched.length, 1);
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

test('destroying the provider while a search is running never crashes and never leaves a cursor open', async () => {
    // Closing the index connection while one of its cursors is open crashes the whole process,
    // so the provider must wait for its searches to end. Every moment of the search is tried.
    const files = Array.from({length: 400}, (_, i) => ['/home/me/Documents', `rapport ${i}.txt`]);
    for (let round = 0; round < 60; round++) {
        const t = setupProvider({files});
        await t.ready;
        await t.search('rapport');
        const pending = t.search('rapport').catch(() => []);
        for (let turns = round % 12; turns > 0; turns--)
            await nextIdle();
        t.provider.destroy();
        await pending;
        for (let turns = 0; turns < 5; turns++)
            await nextIdle();
    }
});

async function failureOf(promise) {
    try {
        await promise;
    } catch (error) {
        return error.message;
    }
    return null;
}

test('a file that is no longer there is not opened, and the failure is reported', async () => {
    const t = setupProvider({missing: ['file:///home/me/Documents/Facture%20mars.pdf']});
    await t.ready;
    const [first] = await t.search('facture');
    assert((await failureOf(t.provider.activate(first)))?.includes('no longer there'), 'no failure reported');
    assertEquals(t.launched, []);
    t.provider.destroy();
});

test('an address that is not a local file is never opened', async () => {
    const t = setupProvider();
    await t.ready;
    for (const url of ['https://example.org/x', 'file://server/share/x', 'file:///a?b=1', 'smb://host/x', '']) {
        assert((await failureOf(t.provider.activate({data: {url}}))) !== null, `${url} was accepted`);
        assert((await failureOf(t.provider.activateAction({data: {parentUrl: url}}, {id: 'open-folder'}))) !== null,
            `${url} was accepted as a folder`);
    }
    assertEquals(t.launched, []);
    t.provider.destroy();
});

const FILE = {data: {url: 'file:///home/me/Documents/Facture%20mars.pdf', parentUrl: 'file:///home/me/Documents'}};

test('a file offers its menu actions, and a result that is not a local file offers none', async () => {
    const t = setupProvider();
    await t.ready;
    assertEquals((await t.provider.actions(FILE)).map(action => action.id), ['open-folder', 'preview', 'copy-path', 'copy-name', 'open-with']);
    assertEquals(await t.provider.actions({data: {url: 'https://example.org/x'}}), []);
    assertEquals(await t.provider.actions({}), []);
    t.provider.destroy();
});

test('Open With lists the applications of the file, the default first', async () => {
    const t = setupProvider({apps: [{id: 'a.desktop', name: 'A'}, {id: 'b.desktop', name: 'B', isDefault: true}]});
    await t.ready;
    const choices = await t.provider.subActions(FILE, {id: 'open-with'});
    assertEquals(choices.map(choice => choice.id), ['open-with:b.desktop', 'open-with:a.desktop']);
    assertEquals(await t.provider.subActions(FILE, {id: 'copy-path'}), [], 'no submenu for another action');
    assertEquals(await t.provider.subActions({data: {url: 'smb://host/x'}}, {id: 'open-with'}), [], 'nothing for a file that is not local');
    t.provider.destroy();
});

test('Open With offers nothing for a file no longer there', async () => {
    const t = setupProvider({apps: [{id: 'a.desktop', name: 'A'}], missing: [FILE.data.url]});
    await t.ready;
    assertEquals(await t.provider.subActions(FILE, {id: 'open-with'}), [], 'its applications are not listed');
    t.provider.destroy();
});

test('Open With launches the chosen application with the file', async () => {
    const t = setupProvider({apps: [{id: 'a.desktop', name: 'A'}, {id: 'b.desktop', name: 'B'}]});
    await t.ready;
    await t.provider.activateAction(FILE, {id: 'open-with:b.desktop'});
    assertEquals(t.launched, ['b.desktop file:///home/me/Documents/Facture%20mars.pdf']);
    t.provider.destroy();
});

test('Open With refuses an application that cannot open this file, a missing file, and anything not local', async () => {
    const t = setupProvider({apps: [{id: 'a.desktop', name: 'A'}], missing: ['file:///home/me/gone.txt']});
    await t.ready;
    assert((await failureOf(t.provider.activateAction(FILE, {id: 'open-with:other.desktop'})))?.includes('cannot open'), 'an unknown application was accepted');
    assert((await failureOf(t.provider.activateAction({data: {url: 'file:///home/me/gone.txt'}}, {id: 'open-with:a.desktop'})))?.includes('no longer there'), 'a missing file was accepted');
    for (const url of ['https://example.org/x', 'file://server/share/x', 'smb://host/x'])
        assert((await failureOf(t.provider.activateAction({data: {url}}, {id: 'open-with:a.desktop'}))) !== null, `${url} was accepted`);
    assertEquals(t.launched, []);
    t.provider.destroy();
});

test('an action the provider does not know is refused and launches nothing', async () => {
    const t = setupProvider();
    await t.ready;
    assert((await failureOf(t.provider.activateAction(FILE, {id: 'format-disk'})))?.includes('unknown action'), 'accepted');
    assertEquals(t.launched, []);
    t.provider.destroy();
});

test('a local file that is still there can be previewed; anything else cannot', async () => {
    const t = setupProvider({missing: ['file:///home/me/gone.txt']});
    await t.ready;
    assertEquals(await t.provider.previewUri(FILE), 'file:///home/me/Documents/Facture%20mars.pdf');
    assertEquals(await t.provider.previewUri({data: {url: 'file:///home/me/gone.txt'}}), null, 'a missing file');
    for (const url of ['https://example.org/x', 'file://server/share/x', 'smb://host/x', '', undefined])
        assertEquals(await t.provider.previewUri({data: {url}}), null, String(url));
    assertEquals(await t.provider.previewUri({}), null);
    t.provider.destroy();
});

test('found files say they can be previewed', async () => {
    const t = setupProvider();
    await t.ready;
    const [first] = await t.search('facture');
    assertEquals(first.previewable, true);
    t.provider.destroy();
});

test('a typed search keeps the files of that type, each once, at most forty', () => {
    const rows = [
        {url: 'file:///a.pdf', name: 'a.pdf', mime: null},
        {url: 'file:///b.png', name: 'b.png', mime: 'image/png'},
        {url: 'file:///a.pdf', name: 'a.pdf', mime: 'application/pdf'},
        {url: 'file:///c', name: 'c', mime: 'application/pdf'},
        {url: 'file:///d.pdf', name: 'd.pdf', mime: 'text/plain'},
    ];
    assertEquals(keepType(rows, 'pdf').map(row => row.url), ['file:///a.pdf', 'file:///c']);
    const many = Array.from({length: 100}, (_, n) => ({url: `file:///${n}.pdf`, name: `${n}.pdf`}));
    assertEquals(keepType(many, 'pdf').length, 40);
    assertEquals(keepType(rows, 'nope'), []);
});

test('a search restricted to a type returns only files of that type, from the index itself', async () => {
    const t = setupProvider();
    await t.ready;
    const typed = typeFilter => t.provider.search('rapport', {cancellable: new Gio.Cancellable(), limit: 6, emit() {}, typeFilter});
    assertEquals((await typed('text')).map(result => result.title), ['rapport-brouillon.txt']);
    assertEquals((await typed('documents')).map(result => result.title), ['Rapport annuel.odt']);
    assertEquals(await typed('images'), []);
    assert((await t.search('rapport')).length > 2, 'without a type, the files of every type');
    t.provider.destroy();
});

test('a search restricted to a type comes best first too', async () => {
    const t = setupProvider({files: [
        ['/home/me/Notes', 'notes du service et rapport de la reunion annuelle.txt'],
        ['/home/me/Notes', 'compte rendu rapport.txt'],
        ['/home/me/Notes', 'rapport.txt'],
    ]});
    await t.ready;
    const results = await t.provider.search('rapport', {cancellable: new Gio.Cancellable(), limit: 6, emit() {}, typeFilter: 'text'});
    const scores = results.map(r => r.providerScore);
    assertEquals(scores.length, 3);
    assertEquals(scores, [...scores].sort((a, b) => b - a));
    assert(scores[0] > scores[2], 'the scores differ, so the order means something');
    t.provider.destroy();
});

const WITH_FOLDERS = [
    ['/home/me/Documents', 'Compta/'],
    ['/home/me/Documents/Archives', 'Compta 2025/'],
    ['/home/me/Documents/Compta', 'compta-mars.ods'],
    ['/home/me/.cache', 'compta-cache/'],
];

test('folders are a source of their own: Files leaves them out, Folders lists only them', async () => {
    const files = setupProvider({files: WITH_FOLDERS});
    const folders = setupProvider({files: WITH_FOLDERS, kind: 'folders'});
    await files.ready;
    await folders.ready;
    assertEquals([files.provider.id, folders.provider.id], ['files', 'folders']);
    assertEquals(folders.provider.name, 'Folders');
    assert(folders.provider.priority > files.provider.priority, 'folders come after files');
    assertEquals((await files.search('compta')).map(r => r.title), ['compta-mars.ods']);
    const found = await folders.search('compta');
    assertEquals(found.map(r => r.title).sort(), ['Compta', 'Compta 2025'], 'hidden folders are left out too');
    assert(found.every(r => r.icon === 'folder' && r.data.folder === true && r.previewable === false), 'each is a folder');
    assertEquals((await folders.provider.actions(found[0])).map(a => a.id), ['open-folder', 'copy-path', 'copy-name', 'open-with']);
    files.provider.destroy();
    folders.provider.destroy();
});

test('"/folders" is a search of Files that finds the folders; the Folders source then stays quiet', async () => {
    const files = setupProvider({files: WITH_FOLDERS});
    const folders = setupProvider({files: WITH_FOLDERS, kind: 'folders'});
    await files.ready;
    await folders.ready;
    const typed = (t, typeFilter) => t.provider.search('compta', {cancellable: new Gio.Cancellable(), limit: 6, emit() {}, typeFilter});
    const found = await typed(files, 'folders');
    assertEquals(found.map(r => r.title).sort(), ['Compta', 'Compta 2025']);
    assert(found.every(r => r.data.folder === true && r.icon === 'folder'), 'they are known as folders');
    assertEquals((await typed(files, 'documents')).map(r => r.data.folder), [false]);
    assertEquals(await typed(folders, 'folders'), []);
    files.provider.destroy();
    folders.provider.destroy();
});

test('without a file manager to select the file, its folder is opened instead, and the log says so', async () => {
    const t = setupProvider({noFileManager: true});
    await t.ready;
    const [first] = await t.search('facture');
    await t.provider.activateAction(first, {id: 'open-folder'});
    assertEquals(t.launched, ['file:///home/me/Documents']);
    assert(t.log.lines.some(line => line.includes('no file manager showed the file')), 'not logged');
    t.provider.destroy();
});

test('a file that is gone is shown neither selected nor through its folder', async () => {
    const url = 'file:///home/me/Documents/Facture%20mars.pdf';
    const t = setupProvider({missing: [url]});
    await t.ready;
    const failure = await failureOf(t.provider.activateAction({data: {url, parentUrl: 'file:///home/me/Documents'}}, {id: 'open-folder'}));
    assert(failure?.includes('no longer there'), `no failure reported: ${failure}`);
    assertEquals(t.shown, []);
    assertEquals(t.launched, []);
    t.provider.destroy();
});

test('an address that is not a local file is never shown in a folder', async () => {
    const t = setupProvider();
    await t.ready;
    for (const url of ['https://example.org/x', 'file://server/share/x', 'smb://host/x', ''])
        assert((await failureOf(t.provider.activateAction({data: {url, parentUrl: 'file:///home/me'}}, {id: 'open-folder'}))) !== null, `${url} was accepted`);
    assertEquals(t.shown, []);
    assertEquals(t.launched, []);
    t.provider.destroy();
});

test('without a file manager, a folder address that is not local is not opened either', async () => {
    const t = setupProvider({noFileManager: true});
    await t.ready;
    const url = 'file:///home/me/Documents/Facture%20mars.pdf';
    for (const parentUrl of ['https://example.org/', 'smb://host/x', ''])
        assert((await failureOf(t.provider.activateAction({data: {url, parentUrl}}, {id: 'open-folder'}))) !== null, `${parentUrl} was opened`);
    assertEquals(t.launched, []);
    t.provider.destroy();
});
