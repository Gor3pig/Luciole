// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Mutation checks: breaks the code on purpose, one small change at a time, and
// requires the tests to notice. A mutant the tests do not notice ("survived") is
// a hole in the tests; a mutant that no longer applies ("stale") means the code
// changed and its specification must be updated.
//
//   gjs -m tests/mutation/run.js [--changed] [--spec <name>] [--list]
//
//   --changed   only the mutants of files changed since the last commit
//               (staged, unstaged or new), which is what `make gate` runs
//   --spec      only tests/mutation/<name>.json
//   --with-slow with --changed, also the specs marked "slow" (tests in a real shell)
//
// Safety: every file is backed up before it is touched and restored after each
// mutant, on error, and on Ctrl+C or termination. A backup left by a run that
// was killed outright is restored at the next start.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GLibUnix from 'gi://GLibUnix';
import System from 'system';

const ROOT = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent();
const SPEC_DIR = ROOT.get_child('tests').get_child('mutation');
const BACKUP_DIR = GLib.build_filenamev([GLib.get_tmp_dir(), 'luciole-mutation-backup']);
const TIMEOUT_SECONDS = 180;

const args = ARGV;
const onlyChanged = args.includes('--changed');
const listOnly = args.includes('--list');
const specName = args.includes('--spec') ? args[args.indexOf('--spec') + 1] : null;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function readText(file) {
    const [, bytes] = file.load_contents(null);
    return decoder.decode(bytes);
}

function writeText(file, text) {
    file.replace_contents(encoder.encode(text), null, false, Gio.FileCreateFlags.NONE, null);
}

function backupPath(relative) {
    return GLib.build_filenamev([BACKUP_DIR, relative.replaceAll('/', '__')]);
}

function restoreAll() {
    const dir = Gio.File.new_for_path(BACKUP_DIR);
    if (!dir.query_exists(null))
        return 0;
    let restored = 0;
    const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null)) {
        const relative = info.get_name().replaceAll('__', '/');
        const backup = dir.get_child(info.get_name());
        writeText(ROOT.resolve_relative_path(relative), readText(backup));
        backup.delete(null);
        restored++;
    }
    dir.delete(null);
    return restored;
}

function runCommand(argv, cwd, timeoutSeconds) {
    return new Promise(resolve => {
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE,
        });
        launcher.set_cwd(cwd);
        const process = launcher.spawnv(argv);
        const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, timeoutSeconds, () => {
            process.force_exit();
            return GLib.SOURCE_REMOVE;
        });
        process.wait_async(null, (_source, result) => {
            GLib.source_remove(timer);
            process.wait_finish(result);
            // A test run that was killed by the timeout counts as a failure of the
            // tests, hence as the mutant being noticed.
            resolve(process.get_if_exited() ? process.get_exit_status() : 124);
        });
    });
}

function lines(argv) {
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE});
    launcher.set_cwd(ROOT.get_path());
    const process = launcher.spawnv(argv);
    const [, out] = process.communicate_utf8(null, null);
    return out.split('\n').filter(line => line !== '');
}

function changedFiles() {
    return new Set([
        ...lines(['git', 'diff', '--name-only', 'HEAD']),
        ...lines(['git', 'ls-files', '--others', '--exclude-standard']),
    ]);
}

function loadSpecs() {
    const specs = [];
    const enumerator = SPEC_DIR.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null)) {
        const name = info.get_name();
        if (!name.endsWith('.json'))
            continue;
        const id = name.slice(0, -'.json'.length);
        if (specName && id !== specName)
            continue;
        specs.push({id, ...JSON.parse(readText(SPEC_DIR.get_child(name)))});
    }
    return specs.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------

const leftover = restoreAll();
if (leftover > 0)
    print(`restored ${leftover} file(s) left modified by an interrupted run`);

for (const signal of [2, 15]) {
    GLibUnix.signal_add(GLib.PRIORITY_HIGH, signal, () => {
        restoreAll();
        print('\ninterrupted: files restored');
        System.exit(130);
        return GLib.SOURCE_REMOVE;
    });
}

const changed = onlyChanged ? changedFiles() : null;
const specs = loadSpecs();
let total = 0;
let killed = 0;
const survivors = [];
const stale = [];
let skipped = 0;

for (const spec of specs) {
    if (spec.slow && onlyChanged && !args.includes('--with-slow'))
        continue;
    for (const mutant of spec.mutants) {
        if (changed && !changed.has(mutant.file)) {
            skipped++;
            continue;
        }
        if (listOnly) {
            print(`${spec.id}: ${mutant.file}: ${mutant.label}`);
            continue;
        }
        const file = ROOT.resolve_relative_path(mutant.file);
        const original = readText(file);
        // A mutant may carry `also`: more replacements in the same file, for a protection that is
        // doubled elsewhere (removing one alone changes nothing, so both go together).
        const edits = [{old: mutant.old, new: mutant.new}, ...(mutant.also ?? [])];
        const occurrences = Math.min(...edits.map(edit => original.split(edit.old).length - 1));
        if (occurrences !== 1 || edits.some(edit => original.split(edit.old).length - 1 !== 1)) {
            stale.push(`${mutant.file}: ${mutant.label} (${occurrences} matches)`);
            print(`STALE     ${mutant.file}: ${mutant.label}`);
            continue;
        }

        total++;
        GLib.mkdir_with_parents(BACKUP_DIR, 0o700);
        writeText(Gio.File.new_for_path(backupPath(mutant.file)), original);
        let status;
        try {
            writeText(file, edits.reduce((text, edit) => text.replace(edit.old, () => edit.new), original));
            status = await runCommand(spec.command, ROOT.get_path(), spec.timeout ?? TIMEOUT_SECONDS);
        } finally {
            writeText(file, original);
            restoreAll();
        }
        if (status === 0) {
            survivors.push(`${mutant.file}: ${mutant.label}`);
            print(`SURVIVED  ${mutant.file}: ${mutant.label}`);
        } else {
            killed++;
        }
    }
}

if (listOnly)
    System.exit(0);

print(`\n${total} mutants run, ${killed} killed, ${survivors.length} survived, ${stale.length} stale` +
    (skipped > 0 ? ` (${skipped} skipped: their files did not change)` : ''));
System.exit(survivors.length > 0 || stale.length > 0 ? 1 : 0);
