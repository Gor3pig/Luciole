// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// What extensions.gnome.org checks in metadata.json, kept true by a test.

import Gio from 'gi://Gio';

import {assert, assertEquals, test} from './harness.js';

function metadata() {
    const file = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('src').get_child('metadata.json');
    const [, bytes] = file.load_contents(null);
    return JSON.parse(new TextDecoder().decode(bytes));
}

test('the description says when the clipboard is written, as extensions.gnome.org requires', () => {
    const {description} = metadata();
    assert(/clipboard/i.test(description), 'the clipboard is not mentioned');
    assert(description.length < 600, 'a reasonable length');
});

test('metadata.json holds what extensions.gnome.org expects, and nothing it sets itself', () => {
    const data = metadata();
    assertEquals(data.uuid, 'luciole@gor3pig.github.io');
    assert(/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/.test(data.uuid), 'uuid form');
    assert(!('version' in data), 'version is set by extensions.gnome.org');
    assert(/^(?!^[. ]+$)[a-zA-Z0-9 .]{1,16}$/.test(data['version-name']), 'version-name form');
    assert(data['shell-version'].every(version => /^\d+$/.test(version)), 'major versions only');
    assert(/^https:\/\/github\.com\//.test(data.url), 'a repository to report issues to');
    assert(data['settings-schema'].startsWith('org.gnome.shell.extensions.'), 'schema id');
    assert(!('session-modes' in data), 'user mode only: no session-modes key');
});
