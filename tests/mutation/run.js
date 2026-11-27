// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Mutation checks: breaks the code on purpose, one small change at a time, and
// requires the tests to notice. A mutant the tests do not notice ("survived") is
// a hole in the tests; a mutant that no longer applies ("stale") means the code
// changed and its specification must be updated.
//
//   gjs -m tests/mutation/run.js [--changed] [--with-slow] [--lines] [--base <ref>]
//                                [--spec <name>] [--jobs <n>] [--sample <share>] [--list]
//
//   --changed    only the mutants of files changed since <ref> (staged, unstaged or new)
//   --with-slow  with --changed, also the specs marked "slow" (tests in a real shell)
//   --lines      with --changed, only the mutants of the changed lines (and a few around them),
//                the mutants new in their specification, and a random share of the others
//   --sample     that share (default 0.1); the seed is printed, LUCIOLE_MUTATION_SEED replays it
//   --base       what "changed" is compared with (default HEAD: what is not committed yet)
//   --spec       only tests/mutation/<name>.json
//   --jobs       how many tests in a real shell run at the same time (default 3)
//   --no-cache   run every chosen mutant, even one already noticed on the very same code
//
// Mutants run in copies of the project, several at a time; the project itself is never
// modified, so an interrupted run leaves nothing behind but temporary copies, removed on
// exit. A mutant may name its own test ("command"), else the one of its specification.
//
// Cache: a mutant the tests noticed is not run again while nothing changed: not a file of the
// sources or the tests, not the mutant, not its test, not the versions of GNOME Shell and GJS
// (see cacheKey in select.js). A survivor is never cached. Kept outside the project, in the
// user's cache folder.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GLibUnix from 'gi://GLibUnix';
import System from 'system';

import {cacheKey, changedLineRanges, isNew, linesOf, sample, touches} from './select.js';

const ROOT = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent();
const SPEC_DIR = ROOT.get_child('tests').get_child('mutation');
// Left by the earlier version of this runner, which modified the project in place.
const OLD_BACKUP_DIR = GLib.build_filenamev([GLib.get_tmp_dir(), 'luciole-mutation-backup']);
const TIMEOUT_SECONDS = 180;
// What a copy holds: everything a test needs to run.
const COPIED = ['src', 'tests', 'Makefile', 'package.json', 'eslint.config.js'];
const FAST_JOBS = 3;
const CACHE_FILE = GLib.build_filenamev([GLib.get_user_cache_dir(), 'luciole', 'mutation-cache.json']);
const CACHE_MAX = 5000;
// What the tree fingerprint leaves out: the specifications (each mutant is part of its own key).
const NOT_IN_TREE = /^tests\/mutation\/[^/]+\.json$/;

const args = ARGV;
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const onlyChanged = args.includes('--changed');
const byLines = args.includes('--lines');
const listOnly = args.includes('--list');
const specName = option('--spec');
const base = option('--base') ?? 'HEAD';
const slowJobs = Math.max(1, Number(option('--jobs') ?? 3) || 3);
const share = Number(option('--sample') ?? 0.1);
const useCache = !args.includes('--no-cache');
const seed = Number(GLib.getenv('LUCIOLE_MUTATION_SEED') ?? Math.floor(Date.now() / 1000) % 100000);

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function readText(file) {
    const [, bytes] = file.load_contents(null);
    return decoder.decode(bytes);
}

function writeText(file, text) {
    file.replace_contents(encoder.encode(text), null, false, Gio.FileCreateFlags.NONE, null);
}

// The earlier runner backed files up before mutating them in place: put back what it left.
function restoreOldBackups() {
    const dir = Gio.File.new_for_path(OLD_BACKUP_DIR);
    if (!dir.query_exists(null))
        return 0;
    let restored = 0;
    const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null)) {
        const backup = dir.get_child(info.get_name());
        writeText(ROOT.resolve_relative_path(info.get_name().replaceAll('__', '/')), readText(backup));
        backup.delete(null);
        restored++;
    }
    dir.delete(null);
    return restored;
}

const running = new Set();

// Runs a test; its output is dropped, or written to `logPath` when one is given.
function runCommand(argv, cwd, timeoutSeconds, logPath = null) {
    return new Promise(resolve => {
        const launcher = new Gio.SubprocessLauncher({
            flags: logPath ? Gio.SubprocessFlags.STDERR_MERGE : Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE,
        });
        if (logPath)
            launcher.set_stdout_file_path(logPath);
        launcher.set_cwd(cwd);
        const process = launcher.spawnv(argv);
        running.add(process);
        const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, timeoutSeconds, () => {
            process.force_exit();
            return GLib.SOURCE_REMOVE;
        });
        process.wait_async(null, (_source, result) => {
            GLib.source_remove(timer);
            running.delete(process);
            process.wait_finish(result);
            // A test run that was killed by the timeout counts as a failure of the
            // tests, hence as the mutant being noticed.
            resolve(process.get_if_exited() ? process.get_exit_status() : 124);
        });
    });
}

function output(argv) {
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE});
    launcher.set_cwd(ROOT.get_path());
    const process = launcher.spawnv(argv);
    const [, out] = process.communicate_utf8(null, null);
    return process.get_successful() ? out : null;
}

const lines = argv => (output(argv) ?? '').split('\n').filter(line => line !== '');

function changedFiles() {
    return new Set([
        ...lines(['git', 'diff', '--name-only', base]),
        ...lines(['git', 'ls-files', '--others', '--exclude-standard']),
    ]);
}

// The changed lines of a file: [first, last] ranges, or null for "all of it" (a new file).
function changedRanges(file) {
    if (lines(['git', 'ls-files', '--others', '--exclude-standard', '--', file]).length > 0)
        return null;
    return changedLineRanges(output(['git', 'diff', '-U0', base, '--', file]) ?? '');
}

function earlierMutants(specId) {
    const text = output(['git', 'show', `${base}:tests/mutation/${specId}.json`]);
    try {
        return text ? JSON.parse(text).mutants : null;
    } catch {
        return null;
    }
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

const copies = [];

// A copy of the project for one worker, made once and reused for each of its mutants.
function makeCopy() {
    const dir = GLib.dir_make_tmp('luciole-mutation-XXXXXX');
    const present = COPIED.filter(name => ROOT.get_child(name).query_exists(null));
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    launcher.set_cwd(ROOT.get_path());
    const process = launcher.spawnv(['cp', '-a', ...present, dir]);
    process.wait(null);
    if (!process.get_successful())
        throw new Error(`could not copy the project to ${dir}`);
    copies.push(dir);
    return dir;
}

function removeCopies() {
    for (const dir of copies)
        new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE}).spawnv(['rm', '-rf', dir]).wait(null);
    copies.length = 0;
}

// ---------------------------------------------------------------------------

const leftover = restoreOldBackups();
if (leftover > 0)
    print(`restored ${leftover} file(s) left modified by an interrupted run of the earlier runner`);

for (const signal of [2, 15]) {
    GLibUnix.signal_add(GLib.PRIORITY_HIGH, signal, () => {
        for (const process of running)
            process.force_exit();
        removeCopies();
        print('\ninterrupted: the project was never modified; the copies are removed');
        System.exit(130);
        return GLib.SOURCE_REMOVE;
    });
}

const changed = onlyChanged ? changedFiles() : null;
const rangesCache = new Map();
const rangesOf = file => {
    if (!rangesCache.has(file))
        rangesCache.set(file, changedRanges(file));
    return rangesCache.get(file);
};

const chosen = [];
const stale = [];
let skipped = 0;
let onLines = 0;
let fresh = 0;
let drawn = 0;

for (const spec of loadSpecs()) {
    if (spec.slow && onlyChanged && !args.includes('--with-slow'))
        continue;
    const earlier = byLines ? earlierMutants(spec.id) : null;
    const others = [];
    for (const mutant of spec.mutants) {
        if (changed && !changed.has(mutant.file)) {
            skipped++;
            continue;
        }
        const text = readText(ROOT.resolve_relative_path(mutant.file));
        // A mutant may carry `also`: more replacements in the same file, for a protection that is
        // doubled elsewhere (removing one alone changes nothing, so both go together).
        const edits = [{old: mutant.old, new: mutant.new}, ...(mutant.also ?? [])];
        if (edits.some(edit => text.split(edit.old).length - 1 !== 1)) {
            stale.push(`${mutant.file}: ${mutant.label}`);
            print(`STALE     ${mutant.file}: ${mutant.label}`);
            continue;
        }
        const entry = {spec, mutant, edits};
        if (!changed || !byLines) {
            chosen.push(entry);
            continue;
        }
        const ranges = rangesOf(mutant.file);
        const place = linesOf(text, mutant.old);
        if (ranges === null || (place && touches(place, ranges))) {
            onLines++;
            chosen.push(entry);
        } else if (isNew(mutant, earlier)) {
            fresh++;
            chosen.push(entry);
        } else {
            others.push(entry);
        }
    }
    // Each spec draws its own share, from a seed of its own derived from the printed one.
    const picked = sample(others, share, seed * 31 + spec.id.length);
    drawn += picked.length;
    skipped += others.length - picked.length;
    chosen.push(...picked);
}

if (listOnly) {
    for (const {spec, mutant} of chosen)
        print(`${spec.id}: ${mutant.file}: ${mutant.label}`);
    System.exit(0);
}
if (changed && byLines)
    print(`chosen: ${onLines} on changed lines, ${fresh} new or changed, ${drawn} drawn at random (seed ${seed})`);

// ---- Cache of the mutants already noticed ----

function treeFingerprint() {
    const files = lines(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '--', ...COPIED])
        .filter(path => !NOT_IN_TREE.test(path)).sort();
    const all = new GLib.Checksum(GLib.ChecksumType.SHA256);
    for (const path of new Set(files)) {
        const file = ROOT.resolve_relative_path(path);
        if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) !== Gio.FileType.REGULAR)
            continue;
        const [, bytes] = file.load_contents(null);
        all.update(encoder.encode(`${path}\0${GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes)}\0`));
    }
    return all.get_string();
}

function loadCache() {
    try {
        const list = JSON.parse(readText(Gio.File.new_for_path(CACHE_FILE)));
        return Array.isArray(list) ? list.filter(key => typeof key === 'string') : [];
    } catch {
        return [];
    }
}

function saveCache(keys) {
    GLib.mkdir_with_parents(GLib.path_get_dirname(CACHE_FILE), 0o700);
    // Written whole then renamed: an interrupted run never leaves a half-written cache.
    const file = Gio.File.new_for_path(CACHE_FILE);
    file.replace_contents(encoder.encode(JSON.stringify(keys.slice(-CACHE_MAX))), null, false,
        Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

const versions = useCache ? [output(['gnome-shell', '--version']), output(['gjs', '--version'])] : null;
const tree = useCache ? treeFingerprint() : null;
const keyOf = ({spec, mutant}) => GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256,
    cacheKey({tree, mutant, command: mutant.command ?? spec.command, versions}), -1);
const cached = useCache ? loadCache() : [];
const known = new Set(cached);
const noticed = [];
let reused = 0;
const toRun = chosen.filter(entry => {
    if (useCache && known.has(keyOf(entry))) {
        reused++;
        return false;
    }
    return true;
});
if (reused > 0)
    print(`${reused} already noticed on this very code (cache), not run again`);

// Slow mutants (a real shell each) and quick ones run in their own pools, side by side.
const slowQueue = toRun.filter(entry => entry.spec.slow);
const fastQueue = toRun.filter(entry => !entry.spec.slow);
let killed = 0;
const survivors = [];

async function worker(queue, dir) {
    for (let entry = queue.shift(); entry; entry = queue.shift()) {
        const {spec, mutant, edits} = entry;
        const file = Gio.File.new_for_path(GLib.build_filenamev([dir, mutant.file]));
        const original = readText(file);
        let status;
        try {
            writeText(file, edits.reduce((text, edit) => text.replace(edit.old, () => edit.new), original));
            status = await runCommand(mutant.command ?? spec.command, dir, spec.timeout ?? TIMEOUT_SECONDS);
        } finally {
            writeText(file, original);
        }
        if (status === 0) {
            survivors.push(`${mutant.file}: ${mutant.label}`);
            print(`SURVIVED  ${mutant.file}: ${mutant.label}`);
        } else {
            killed++;
            if (useCache)
                noticed.push(keyOf(entry));
        }
    }
}

// First, each test once without any mutant, in the same conditions (copies, side by side): a
// test that fails on its own would count every mutant as noticed and hide the ones it misses.
let baselineRuns = 0;
async function baseline(queue, dirs) {
    const commands = new Map();
    for (const {spec, mutant} of queue) {
        const argv = mutant.command ?? spec.command;
        commands.set(JSON.stringify(argv), {argv, timeout: spec.timeout ?? TIMEOUT_SECONDS});
    }
    const pending = [...commands.values()];
    const failed = [];
    await Promise.all(dirs.map(async dir => {
        for (let next = pending.shift(); next; next = pending.shift()) {
            // One log per command: a shared one would show the lines of the next command run.
            const log = GLib.build_filenamev([dir, `baseline-${++baselineRuns}.log`]);
            if (await runCommand(next.argv, dir, next.timeout, log) !== 0) {
                const logLines = readText(Gio.File.new_for_path(log)).trimEnd().split('\n');
                // The test's own verdict first ("FAIL: ..."), then where the log ends.
                const verdicts = logLines.filter(line => line.startsWith('FAIL'));
                failed.push(`${next.argv.join(' ')}\n    ${[...verdicts, ...logLines.slice(-8)].join('\n    ')}`);
            }
        }
    }));
    return failed;
}

const pools = [];
for (const [queue, jobs] of [[slowQueue, slowJobs], [fastQueue, FAST_JOBS]]) {
    const dirs = [];
    for (let n = 0; n < Math.min(jobs, queue.length); n++)
        dirs.push(makeCopy());
    pools.push({queue, dirs});
}
try {
    const failed = (await Promise.all(pools.map(({queue, dirs}) => baseline(queue, dirs)))).flat();
    if (failed.length > 0) {
        for (const command of failed)
            print(`BASELINE FAILED  ${command}`);
        print('\nthe tests fail without any mutant: nothing can be judged until they pass');
        System.exit(1);
    }
    await Promise.all(pools.flatMap(({queue, dirs}) => dirs.map(dir => worker(queue, dir))));
} finally {
    removeCopies();
    if (useCache && noticed.length > 0)
        saveCache([...cached.filter(key => !noticed.includes(key)), ...noticed]);
}

const total = killed + survivors.length;
print(`\n${total} mutants run${reused > 0 ? ` (and ${reused} from the cache)` : ''}, ${killed} killed, ${survivors.length} survived, ${stale.length} stale` +
    (skipped > 0 ? ` (${skipped} skipped${changed && byLines ? ': not on changed lines and not drawn' : ': their files did not change'})` : ''));
System.exit(survivors.length > 0 || stale.length > 0 ? 1 : 0);
