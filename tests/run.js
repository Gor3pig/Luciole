// Runs every tests/*.test.js with plain gjs:  gjs -m tests/run.js

import Gio from 'gi://Gio';
import System from 'system';

import {takeTests} from './harness.js';

const dir = Gio.File.new_for_uri(import.meta.url).get_parent();
const names = [];
const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null)) {
    if (info.get_name().endsWith('.test.js'))
        names.push(info.get_name());
}
names.sort();

let passed = 0;
let failed = 0;

for (const name of names) {
    await import(`${dir.get_uri()}/${name}`);
    for (const {name: title, fn} of takeTests()) {
        try {
            await fn();
            passed++;
            print(`ok   ${name}: ${title}`);
        } catch (error) {
            failed++;
            print(`FAIL ${name}: ${title}\n     ${error.message}`);
        }
    }
}

print(`\n${passed} passed, ${failed} failed`);
System.exit(failed > 0 || passed === 0 ? 1 : 0);
