// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {HistoryCursor, MAX_QUERIES, MAX_QUERY_CHARS, QueryHistory} from '../src/core/query-history.js';
import {assert, assertEquals, test} from './harness.js';

// Written with escapes on purpose: no bidirectional character may sit in a source file.
const RLO = String.fromCodePoint(0x202e);

test('a remembered search comes back first, newest first', () => {
    const history = new QueryHistory();
    history.record('firefox');
    history.record('calculatrice');
    assertEquals(history.entries, ['calculatrice', 'firefox']);
    assert(history.dirty, 'recording must mark the history as changed');
});

test('the same search is kept once, moved to the front, whatever its case and spacing', () => {
    const history = new QueryHistory();
    history.record('firefox');
    history.record('notes');
    history.record('  FireFox ');
    assertEquals(history.entries, ['FireFox', 'notes']);
    history.record('Fire   Fox');
    assertEquals(history.entries, ['Fire Fox', 'FireFox', 'notes']);
});

test('recording the search already first changes nothing', () => {
    const history = new QueryHistory();
    history.record('notes');
    history.markSaved();
    history.record('notes');
    assert(!history.dirty, 'nothing changed, nothing to save');
});

test('nothing useful to remember: empty, blank, too long or not a text', () => {
    const history = new QueryHistory();
    for (const odd of ['', '   ', '\n\t', 'x'.repeat(MAX_QUERY_CHARS + 1), undefined, null, 5, {}, ['a']])
        history.record(odd);
    assertEquals(history.entries, []);
    assert(!history.dirty, 'nothing recorded, nothing to save');
    history.record('x'.repeat(MAX_QUERY_CHARS));
    assertEquals(history.size, 1, 'the longest search the field takes is kept');
});

test('only the most recent searches are kept', () => {
    const history = new QueryHistory();
    for (let n = 0; n < MAX_QUERIES + 5; n++)
        history.record(`search ${n}`);
    assertEquals(history.size, MAX_QUERIES);
    assertEquals(history.entries[0], `search ${MAX_QUERIES + 4}`);
    assertEquals(history.entries[MAX_QUERIES - 1], 'search 5');
});

test('control and bidirectional characters never get into the history', () => {
    const history = new QueryHistory();
    history.record(`report${RLO}fdp.exe\nsecond line`);
    assertEquals(history.entries.length, 1);
    assert(!history.entries[0].includes(RLO) && !history.entries[0].includes('\n'), `kept: ${JSON.stringify(history.entries[0])}`);
});

test('entries is a copy: changing it does not change the history', () => {
    const history = new QueryHistory();
    history.record('notes');
    history.entries.push('intruder');
    history.entries[0] = 'other';
    assertEquals(history.entries, ['notes']);
});

test('clearing forgets everything and is a change only if there was something', () => {
    const history = new QueryHistory();
    history.clear();
    assert(!history.dirty, 'clearing nothing is not a change');
    history.record('notes');
    history.markSaved();
    history.clear();
    assertEquals(history.entries, []);
    assert(history.dirty, 'clearing must be saved');
});

test('what is serialized is read back the same', () => {
    const history = new QueryHistory();
    for (const q of ['one', 'two', 'three'])
        history.record(q);
    assertEquals(QueryHistory.from(JSON.parse(JSON.stringify(history.serialize()))).entries, ['three', 'two', 'one']);
});

test('a damaged or hostile file gives a clean history', () => {
    for (const odd of [null, undefined, 5, 'x', [], {}, {queries: 'x'}, {queries: {a: 1}}, {queries: [1, null, {}, [], '', '  ']}])
        assertEquals(QueryHistory.from(odd).entries, [], JSON.stringify(odd));
    const loaded = QueryHistory.from({queries: ['ok', 'OK', 3, `bad${RLO}one`, 'x'.repeat(MAX_QUERY_CHARS + 1), ' ok  too ']});
    assertEquals(loaded.entries, ['ok', 'bad' + 'one', 'ok too']);
    const many = QueryHistory.from({queries: Array.from({length: 100}, (_, n) => `q${n}`)});
    assertEquals(many.size, MAX_QUERIES);
    assertEquals(many.entries[0], 'q0', 'the file order (newest first) is kept');
});

test('the up arrow goes back through the searches, newest first, and stops at the oldest', () => {
    const cursor = new HistoryCursor();
    const entries = ['c', 'b', 'a'];
    assert(!cursor.active, 'not active before the first step');
    assertEquals(cursor.older(entries), 'c');
    assert(cursor.active, 'active once a search is shown');
    assertEquals(cursor.older(entries), 'b');
    assertEquals(cursor.older(entries), 'a');
    assertEquals(cursor.older(entries), 'a', 'stays on the oldest');
    assertEquals(cursor.where(entries), {position: 3, total: 3});
});

test('the down arrow comes forward, then back to the empty field', () => {
    const cursor = new HistoryCursor();
    const entries = ['c', 'b', 'a'];
    cursor.older(entries);
    cursor.older(entries);
    assertEquals(cursor.newer(entries), 'c');
    assertEquals(cursor.newer(entries), '', 'past the newest: the empty field');
    assert(!cursor.active, 'inactive again');
    assertEquals(cursor.newer(entries), null, 'nothing to go forward from');
});

test('with no remembered search there is nothing to bring back', () => {
    const cursor = new HistoryCursor();
    assertEquals(cursor.older([]), null);
    assert(!cursor.active, 'still inactive');
    assertEquals(cursor.where([]), null);
});

test('typing leaves the remembered searches: reset starts over', () => {
    const cursor = new HistoryCursor();
    cursor.older(['x', 'y']);
    cursor.reset();
    assert(!cursor.active, 'reset leaves the history');
    assertEquals(cursor.older(['x', 'y']), 'x', 'starts again from the newest');
});

test('a history that shrank or was cleared meanwhile never leaves the cursor outside it', () => {
    const cursor = new HistoryCursor();
    cursor.older(['c', 'b', 'a']);
    cursor.older(['c', 'b', 'a']);
    cursor.older(['c', 'b', 'a']);
    assertEquals(cursor.where(['c']), {position: 1, total: 1});
    assertEquals(cursor.older(['c']), 'c');
    cursor.older(['c', 'b', 'a']);
    cursor.older(['c', 'b', 'a']);
    assertEquals(cursor.newer([]), '', 'cleared: back to the empty field');
    assert(!cursor.active, 'inactive');
});
