// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// "Trojan Source": invisible bidirectional characters in a source file make code read
// differently from how it runs. None may appear in the repository, in any text file; where one is
// needed (the code that removes them, the tests that feed them) it is written as an escape.

import Gio from 'gi://Gio';

import {assertEquals, test} from './harness.js';

const ROOT = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
const TEXT_FILE = /\.(js|json|css|xml|sh|md|po|pot|html)$/;
const SKIP = new Set(['node_modules', '.git', '_local', 'locale', 'dist']);
const RISKY = /[\u2028\u2029\u202a-\u202e\u2066-\u2069\u200e\u200f\ufeff\u200b-\u200d]/u;

function* textFiles(dir) {
    const enumerator = dir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
    for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null)) {
        const name = info.get_name();
        if (SKIP.has(name))
            continue;
        const child = dir.get_child(name);
        if (info.get_file_type() === Gio.FileType.DIRECTORY)
            yield* textFiles(child);
        else if (TEXT_FILE.test(name))
            yield child;
    }
}

test('no invisible bidirectional or zero-width character in any source file', () => {
    const found = [];
    for (const file of textFiles(ROOT)) {
        const [, bytes] = file.load_contents(null);
        const text = new TextDecoder().decode(bytes);
        const at = text.search(RISKY);
        if (at >= 0)
            found.push(`${ROOT.get_relative_path(file)}: U+${text.codePointAt(at).toString(16).padStart(4, '0')}`);
    }
    assertEquals(found, []);
});
