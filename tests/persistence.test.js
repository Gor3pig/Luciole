// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// The usage history file, against a real temporary directory.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Frecency} from '../src/core/frecency.js';
import {QueryHistory} from '../src/core/query-history.js';
import {FrecencyStore, MAX_HISTORY_BYTES, QueryHistoryStore} from '../src/shell/persistence.js';
import {FakeScheduler} from './fakes/scheduler.js';
import {recordingLog} from './fakes/provider.js';
import {assert, assertEquals, test} from './harness.js';

const NOW = 1_700_000_000_000;

function setup() {
    const directory = GLib.dir_make_tmp('luciole-history-XXXXXX');
    const log = recordingLog();
    const store = new FrecencyStore({log, scheduler: new FakeScheduler(), directory});
    const file = Gio.File.new_for_path(GLib.build_filenamev([directory, 'frecency.json']));
    const cleanup = () => {
        try {
            file.delete(null);
        } catch {
            // Never written.
        }
        Gio.File.new_for_path(directory).delete(null);
    };
    return {directory, log, store, file, cleanup};
}

const sleep = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

async function untilExists(file) {
    for (let i = 0; i < 200 && !file.query_exists(null); i++)
        await sleep(10);
    assert(file.query_exists(null), 'the history file was never written');
    await sleep(30);
}

test('no history file gives an empty history, without a warning', async () => {
    const t = setup();
    const frecency = await t.store.load();
    assertEquals(frecency.size, 0);
    assertEquals(t.log.lines, []);
    t.cleanup();
});

test('what is saved is read back, and the file is private to the user', async () => {
    const t = setup();
    const first = new Frecency();
    first.record('apps:firefox', NOW);
    first.record('apps:firefox', NOW - 1000);
    t.store.save(first);
    await untilExists(t.file);
    const mode = t.file.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null).get_attribute_uint32('unix::mode');
    assertEquals(mode & 0o777, 0o600, 'the history file must be readable by its owner only');
    const second = await t.store.load();
    assertEquals(second.score('apps:firefox', NOW), first.score('apps:firefox', NOW));
    t.cleanup();
});

test('a corrupt history file is ignored with a warning', async () => {
    const t = setup();
    t.file.replace_contents(new TextEncoder().encode('{"entries": [oops'), null, false, Gio.FileCreateFlags.NONE, null);
    const frecency = await t.store.load();
    assertEquals(frecency.size, 0);
    assert(t.log.lines.some(line => line.startsWith('warn: history ignored')), 'no warning');
    t.cleanup();
});

test('a history file larger than the limit is not read at all', async () => {
    const t = setup();
    t.file.replace_contents(new Uint8Array(MAX_HISTORY_BYTES + 1).fill(0x20), null, false, Gio.FileCreateFlags.NONE, null);
    const frecency = await t.store.load();
    assertEquals(frecency.size, 0);
    assert(t.log.lines.some(line => line.includes('history ignored') && line.includes('allowed')), 'no warning');
    t.cleanup();
});

test('a history file just under the limit is still read', async () => {
    const t = setup();
    const padding = ' '.repeat(MAX_HISTORY_BYTES - 40);
    t.file.replace_contents(new TextEncoder().encode(`{"entries":{"k":[${NOW}]}}${padding}`), null, false,
        Gio.FileCreateFlags.NONE, null);
    const frecency = await t.store.load();
    assertEquals(frecency.size, 1);
    t.cleanup();
});

// The searches file: same machinery, its own file.
function setupQueries() {
    const directory = GLib.dir_make_tmp('luciole-queries-XXXXXX');
    const log = recordingLog();
    const store = new QueryHistoryStore({log, scheduler: new FakeScheduler(), directory});
    const file = Gio.File.new_for_path(GLib.build_filenamev([directory, 'queries.json']));
    const cleanup = () => {
        try {
            file.delete(null);
        } catch {
            // Never written.
        }
        Gio.File.new_for_path(directory).delete(null);
    };
    return {log, store, file, cleanup};
}

test('remembered searches are saved to their own private file and read back', async () => {
    const t = setupQueries();
    const history = new QueryHistory();
    history.record('firefox');
    history.record('notes');
    t.store.save(history);
    await untilExists(t.file);
    const mode = t.file.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null).get_attribute_uint32('unix::mode');
    assertEquals(mode & 0o777, 0o600, 'the searches file must be readable by its owner only');
    assertEquals((await t.store.load()).entries, ['notes', 'firefox']);
    t.cleanup();
});

test('no searches file, or a corrupt one, gives an empty history', async () => {
    const t = setupQueries();
    assertEquals((await t.store.load()).entries, []);
    assertEquals(t.log.lines, []);
    t.file.replace_contents(new TextEncoder().encode('{"queries": [oops'), null, false, Gio.FileCreateFlags.NONE, null);
    assertEquals((await t.store.load()).entries, []);
    assert(t.log.lines.some(line => line.startsWith('warn: history ignored')), 'no warning');
    t.cleanup();
});

test('a searches file larger than the limit is not read at all', async () => {
    const t = setupQueries();
    t.file.replace_contents(new Uint8Array(MAX_HISTORY_BYTES + 1).fill(0x20), null, false, Gio.FileCreateFlags.NONE, null);
    assertEquals((await t.store.load()).entries, []);
    assert(t.log.lines.some(line => line.includes('history ignored') && line.includes('allowed')), 'no warning');
    t.cleanup();
});

test('nothing changed, nothing written', async () => {
    const t = setupQueries();
    t.store.save(new QueryHistory());
    await sleep(100);
    assert(!t.file.query_exists(null), 'an unchanged history must not create a file');
    Gio.File.new_for_path(t.file.get_parent().get_path()).delete(null);
});
