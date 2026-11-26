// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Frecency} from '../core/frecency.js';
import {QueryHistory} from '../core/query-history.js';

const SAVE_DELAY_MS = 2000;
// The history holds a few hundred short entries (see Frecency); a file far larger than that is
// not ours, or is damaged, and is not read into memory at all.
export const MAX_HISTORY_BYTES = 1024 * 1024;

/**
 * Keeps one kind of history in a private file of the user's data directory.
 * Nothing here blocks the main loop: reading and writing are asynchronous, and
 * a burst of changes is written once, a moment later.
 *
 * The history object has dirty, markSaved() and serialize(); `revive` rebuilds one from
 * parsed JSON (anything malformed gives an empty one) and `empty` makes a new one.
 */
class HistoryFile {
    #file;
    #directory;
    #log;
    #scheduler;
    #revive;
    #empty;
    #pending = null;

    constructor({log, scheduler, directory, fileName, revive, empty}) {
        this.#log = log;
        this.#scheduler = scheduler;
        this.#directory = Gio.File.new_for_path(directory);
        this.#file = this.#directory.get_child(fileName);
        this.#revive = revive;
        this.#empty = empty;
    }

    /** Reads the history. A missing, unreadable or corrupt file gives an empty one. */
    async load() {
        try {
            const size = await new Promise((resolve, reject) => {
                this.#file.query_info_async('standard::size', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null,
                    (file, result) => {
                        try {
                            resolve(file.query_info_finish(result).get_size());
                        } catch (error) {
                            reject(error);
                        }
                    });
            });
            if (size > MAX_HISTORY_BYTES) {
                this.#log.warn(`history ignored: the file is ${size} bytes, more than the ${MAX_HISTORY_BYTES} allowed`);
                return this.#empty();
            }
            const bytes = await new Promise((resolve, reject) => {
                this.#file.load_contents_async(null, (file, result) => {
                    try {
                        resolve(file.load_contents_finish(result)[1]);
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            return this.#revive(JSON.parse(new TextDecoder().decode(bytes)));
        } catch (error) {
            if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                this.#log.warn(`history ignored: ${error.message}`);
            return this.#empty();
        }
    }

    /** Writes the history in a moment; calls made in the meantime share that write. */
    scheduleSave(history) {
        if (this.#pending)
            return;
        this.#pending = this.#scheduler.timeout(SAVE_DELAY_MS);
        const pending = this.#pending;
        pending.promise.then(() => {
            if (this.#pending === pending) {
                this.#pending = null;
                this.save(history);
            }
        });
    }

    /** Writes now (asynchronously). Does nothing when nothing changed. */
    save(history) {
        this.#pending?.cancel();
        this.#pending = null;
        if (!history.dirty)
            return;
        const bytes = new TextEncoder().encode(JSON.stringify(history.serialize()));
        history.markSaved();
        this.#write(bytes).catch(error => {
            this.#log.error('could not save the history', error);
        });
    }

    #write(bytes) {
        return new Promise((resolve, reject) => {
            // The directory may not exist yet; "already exists" is fine.
            this.#directory.make_directory_async(GLib.PRIORITY_DEFAULT, null, (dir, mkdirResult) => {
                try {
                    dir.make_directory_finish(mkdirResult);
                } catch (error) {
                    if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) {
                        reject(error);
                        return;
                    }
                }
                // PRIVATE: the file records what the user opens and searches for.
                this.#file.replace_contents_bytes_async(
                    new GLib.Bytes(bytes), null, false,
                    Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION,
                    null, (file, result) => {
                        try {
                            file.replace_contents_finish(result);
                            resolve();
                        } catch (error) {
                            reject(error);
                        }
                    });
            });
        });
    }
}

const defaultDirectory = () => GLib.build_filenamev([GLib.get_user_data_dir(), 'luciole']);

/** The usage history (which results were opened, how often and when). */
export class FrecencyStore extends HistoryFile {
    constructor({log, scheduler, directory = defaultDirectory()}) {
        super({log, scheduler, directory, fileName: 'frecency.json', revive: Frecency.from, empty: () => new Frecency()});
    }
}

/** The searches that led to a result being opened. */
export class QueryHistoryStore extends HistoryFile {
    constructor({log, scheduler, directory = defaultDirectory()}) {
        super({log, scheduler, directory, fileName: 'queries.json', revive: QueryHistory.from, empty: () => new QueryHistory()});
    }
}
