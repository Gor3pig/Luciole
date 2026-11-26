// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';

import {FILE_TYPES, fileIsOfType, parseTypeQuery, typeLabels, typeNamed, typePrefix} from '../src/core/type-filter.js';
import {assert, assertEquals, test} from './harness.js';

test('"/" alone offers every type, in order', () => {
    assertEquals(parseTypeQuery('/'), {suggestions: FILE_TYPES.map(type => type.id)});
    assertEquals(parseTypeQuery('  /'), {suggestions: FILE_TYPES.map(type => type.id)}, 'spaces before it do not matter');
});

test('the beginning of a type offers the types it can still become', () => {
    assertEquals(parseTypeQuery('/pd'), {suggestions: ['pdf']});
    assertEquals(parseTypeQuery('/d'), {suggestions: ['documents', 'folders']});
    assertEquals(parseTypeQuery('/pdf'), {suggestions: ['pdf']}, 'a whole name without a space is still being typed');
    assertEquals(parseTypeQuery('/Vid'), {suggestions: ['videos']}, 'case does not matter');
});

test('a type followed by a space restricts the search to it, with the words after it', () => {
    assertEquals(parseTypeQuery('/pdf facture'), {type: 'pdf', text: 'facture'});
    assertEquals(parseTypeQuery('/pdf '), {type: 'pdf', text: ''});
    assertEquals(parseTypeQuery('/Images   chat noir '), {type: 'images', text: 'chat noir'});
    assertEquals(parseTypeQuery('/vidéos vacances'), {type: 'videos', text: 'vacances'}, 'accents do not matter');
    assertEquals(parseTypeQuery('/dossiers projet'), {type: 'folders', text: 'projet'});
    assertEquals(parseTypeQuery('/folders projet'), {type: 'folders', text: 'projet'}, 'English names too');
});

test('anything else is an ordinary search', () => {
    for (const text of ['notes', '/etc/hosts', '/xyz facture', '/e', 'pdf facture', '//', '/ pdf', '/pdf/x', '/2026 x', '', '   '])
        assertEquals(parseTypeQuery(text), null, JSON.stringify(text));
    for (const odd of [undefined, null, 5, {}])
        assertEquals(parseTypeQuery(odd), null, String(odd));
});

test('types are found by any of their names, and nothing else is', () => {
    assertEquals(typeNamed('PDF').id, 'pdf');
    assertEquals(typeNamed('photos').id, 'images');
    assertEquals(typeNamed('musique').id, 'music');
    for (const odd of ['', 'pd', 'x'.repeat(30), undefined, 5, 'constructor', '__proto__'])
        assertEquals(typeNamed(odd), null, String(odd));
});

test('a file is of a type by the MIME type the index knows', () => {
    assert(fileIsOfType('images', {mime: 'image/png', name: 'x.txt'}), 'the MIME type wins over the name');
    assert(fileIsOfType('pdf', {mime: 'application/pdf', name: 'x'}), 'pdf');
    assert(fileIsOfType('documents', {mime: 'application/pdf', name: 'x'}), 'a PDF is a document');
    assert(fileIsOfType('documents', {mime: 'application/vnd.oasis.opendocument.text', name: 'x'}), 'odt');
    assert(fileIsOfType('folders', {mime: 'inode/directory', name: 'x'}), 'folder');
    assert(fileIsOfType('text', {mime: 'text/markdown', name: 'x'}), 'markdown');
    assert(!fileIsOfType('pdf', {mime: 'application/pdfx', name: 'x.pdf'}), 'an exact type is matched exactly');
    assert(!fileIsOfType('images', {mime: 'text/plain', name: 'photo.png'}), 'a known MIME type is not overridden by the name');
});

test('without a MIME type, the extension decides', () => {
    assert(fileIsOfType('images', {mime: null, name: 'Photo.JPG'}), 'case of the extension');
    assert(fileIsOfType('pdf', {name: 'Facture mars.pdf'}), 'pdf by name');
    assert(fileIsOfType('archives', {mime: '', name: 'a.tar.gz'}), 'the last extension');
    assert(!fileIsOfType('pdf', {name: 'pdf'}), 'no extension');
    assert(!fileIsOfType('pdf', {name: '.pdf'}), 'a hidden name is not an extension');
    assert(!fileIsOfType('pdf', {name: 'x.'}), 'an empty extension');
    assert(!fileIsOfType('folders', {name: 'x.folder'}), 'folders have no extension');
});

test('an unknown type matches nothing', () => {
    assert(!fileIsOfType('nope', {mime: 'image/png', name: 'a.png'}), 'unknown');
    assert(!fileIsOfType(undefined, {name: 'a.png'}), 'none');
    assert(!fileIsOfType('images'), 'no file');
});

test('a type is written back the way it is read', () => {
    for (const type of FILE_TYPES) {
        const prefix = typePrefix(type.id);
        assert(prefix.startsWith('/') && prefix.endsWith(' '), prefix);
        assertEquals(parseTypeQuery(`${prefix}x`), {type: type.id, text: 'x'}, type.id);
    }
    assertEquals(typePrefix('nope'), '');
});

test('every type has a translated name', () => {
    const labels = typeLabels(text => `[${text}]`);
    for (const type of FILE_TYPES)
        assert(typeof labels[type.id] === 'string' && labels[type.id].startsWith('['), type.id);
});

test('each extension of a type is accepted through the MIME type the system gives it too', () => {
    // The index names a file's type the way GIO does: an extension listed under a type whose MIME
    // list missed its MIME type would be left out whenever the index knows the type.
    const missing = [];
    for (const type of FILE_TYPES) {
        for (const extension of type.extensions) {
            const [mime, uncertain] = Gio.content_type_guess(`file.${extension}`, null);
            if (uncertain || mime === 'application/octet-stream')
                continue;
            if (!fileIsOfType(type.id, {mime, name: `file.${extension}`}))
                missing.push(`${type.id}: .${extension} is ${mime}`);
        }
    }
    // Compressed tar archives have a type of their own.
    for (const name of ['file.tar.gz', 'file.tar.xz', 'file.tar.bz2', 'file.tar.zst', 'file.tgz']) {
        const [mime, uncertain] = Gio.content_type_guess(name, null);
        if (!uncertain && !fileIsOfType('archives', {mime, name}))
            missing.push(`archives: ${name} is ${mime}`);
    }
    assertEquals(missing, []);
});
