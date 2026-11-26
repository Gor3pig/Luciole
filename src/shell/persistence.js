// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Frecency} from '../core/frecency.js';

const SAVE_DELAY_MS = 2000;
// The history holds a few hundred short entries (see Frecency); a file far larger than that is
// not ours, or is damaged, and is not read into memory at all.
export const MAX_HISTORY_BYTES = 1024 * 1024;

/**
 * Keeps the usage history in a private file of the user's data directory.
 * Nothing here blocks the main loop: reading and writing are asynchronous, and
 * a burst of activations is written once, a moment later.
 */
export class FrecencyStore {
    #file;
    #directory;
    #log;
    #scheduler;
    #pending = null;

    constructor({log, scheduler, directory = GLib.build_filenamev([GLib.get_user_data_dir(), 'luciole'])}) {
        this.#log = log;
        this.#scheduler = scheduler;
        this.#directory = Gio.File.new_for_path(directory);
        this.#file = this.#directory.get_child('frecency.json');
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
                return new Frecency();
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
            return Frecency.from(JSON.parse(new TextDecoder().decode(bytes)));
        } catch (error) {
            if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                this.#log.warn(`history ignored: ${error.message}`);
            return new Frecency();
        }
    }

    /** Writes the history in a moment; calls made in the meantime share that write. */
    scheduleSave(frecency) {
        if (this.#pending)
            return;
        this.#pending = this.#scheduler.timeout(SAVE_DELAY_MS);
        const pending = this.#pending;
        pending.promise.then(() => {
            if (this.#pending === pending) {
                this.#pending = null;
                this.save(frecency);
            }
        });
    }

    /** Writes now (asynchronously). Does nothing when nothing changed. */
    save(frecency) {
        this.#pending?.cancel();
        this.#pending = null;
        if (!frecency.dirty)
            return;
        const bytes = new TextEncoder().encode(JSON.stringify(frecency.serialize()));
        frecency.markSaved();
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
                // PRIVATE: the file records which applications the user opens.
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
