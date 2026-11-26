// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Tracker from 'gi://Tracker';

import {Provider} from '../core/provider.js';
import {buildFtsTerms, fileActionList, isLocalFileUri, OPEN_WITH_PREFIX, openWithActions, rowsToResults} from './files-query.js';

const LOCALSEARCH_BUS_NAME = 'org.freedesktop.LocalSearch3';

// The user's text reaches this query only as the bound value ~terms, never as
// part of the SPARQL text. LIMIT leaves room for the rows that exclusions drop.
const QUERY = `
SELECT ?url ?name ?modified (fts:rank(?f) AS ?rank)
WHERE {
    ?f a nfo:FileDataObject ;
       nie:url ?url ;
       nfo:fileName ?name ;
       nfo:fileLastModified ?modified ;
       fts:match ~terms
}
ORDER BY DESC(?rank)
LIMIT 40`;

/** Connects to the user's LocalSearch index, without blocking the main loop. */
function openLocalSearch(cancellable) {
    return new Promise((resolve, reject) => {
        Tracker.SparqlConnection.bus_new_async(LOCALSEARCH_BUS_NAME, null, Gio.DBus.session, cancellable,
            (_source, result) => {
                try {
                    resolve(Tracker.SparqlConnection.bus_new_finish(result));
                } catch (error) {
                    reject(error);
                }
            });
    });
}

/** Whether the file or folder is still there, asked without blocking. */
function uriExists(uri, cancellable) {
    return new Promise(resolve => {
        Gio.File.new_for_uri(uri).query_info_async('standard::name', Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT, cancellable, (file, result) => {
                try {
                    file.query_info_finish(result);
                    resolve(true);
                } catch {
                    resolve(false);
                }
            });
    });
}

/** The content type of a file, asked without blocking. */
function contentTypeOf(uri, cancellable) {
    return new Promise((resolve, reject) => {
        Gio.File.new_for_uri(uri).query_info_async('standard::content-type', Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT, cancellable, (file, result) => {
                try {
                    resolve(file.query_info_finish(result).get_content_type());
                } catch (error) {
                    reject(error);
                }
            });
    });
}

/** The applications that can open a file: [{id, name, isDefault, launch(uri)}]. */
async function appsForUri(uri, cancellable) {
    const type = await contentTypeOf(uri, cancellable);
    if (!type)
        return [];
    const defaultId = Gio.AppInfo.get_default_for_type(type, false)?.get_id() ?? null;
    return Gio.AppInfo.get_all_for_type(type)
        .filter(app => app.should_show() && app.get_id())
        .map(app => ({
            id: app.get_id(),
            name: app.get_name(),
            isDefault: app.get_id() === defaultId,
            launch: target => app.launch_uris([target], null),
        }));
}

function openUri(uri, cancellable) {
    return new Promise((resolve, reject) => {
        Gio.AppInfo.launch_default_for_uri_async(uri, null, cancellable, (_source, result) => {
            try {
                resolve(Gio.AppInfo.launch_default_for_uri_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

/**
 * Runs the query for some full-text terms and reads the rows asynchronously.
 * The cursor is always closed before the promise settles.
 *
 * @returns {Promise<Array<{url: string, name: string, modified: string, rank: number}>>}
 */
function runQuery(connection, terms, cancellable) {
    return new Promise((resolve, reject) => {
        let statement;
        try {
            statement = connection.query_statement(QUERY, null);
            statement.bind_string('terms', terms);
        } catch (error) {
            reject(error);
            return;
        }
        statement.execute_async(cancellable, (_source, result) => {
            let cursor;
            try {
                cursor = statement.execute_finish(result);
            } catch (error) {
                reject(error);
                return;
            }
            const rows = [];
            const done = error => {
                try {
                    cursor.close();
                } catch {
                    // Already closed; nothing to release.
                }
                if (error)
                    reject(error);
                else
                    resolve(rows);
            };
            const readNext = () => cursor.next_async(cancellable, (_cursor, step) => {
                try {
                    if (!cursor.next_finish(step)) {
                        done(null);
                        return;
                    }
                    rows.push({
                        url: cursor.get_string(0)[0],
                        name: cursor.get_string(1)[0],
                        modified: cursor.get_string(2)[0],
                        rank: cursor.get_double(3),
                    });
                    readNext();
                } catch (error) {
                    done(error);
                }
            });
            readNext();
        });
    });
}

function iconForName(name) {
    const [type] = Gio.content_type_guess(name, null);
    return Gio.content_type_get_icon(type);
}

/**
 * Files found through the LocalSearch index (TinySPARQL): the user's own
 * index, no indexing of our own. The connection is opened the first time a
 * file search is needed, never at start-up; if the service is missing the
 * provider turns itself off for the session and says so once.
 */
export class FilesProvider extends Provider {
    #openConnection;
    #open;
    #exists;
    #appsFor;
    #connection = null;
    #connecting = null;
    #destroyed = false;
    #settings = null;
    #log = null;
    #gettext = null;
    #lifetime = new Gio.Cancellable();
    // Searches that have started and not ended. Closing the connection while one of them
    // still holds a cursor (or is about to query) crashes the process or hangs it, so
    // destroy() waits for them all.
    #running = new Set();

    /**
     * @param {object} [options]
     * @param {(cancellable: Gio.Cancellable) => Promise<object>} [options.openConnection] - for tests
     * @param {(uri: string, cancellable: Gio.Cancellable) => Promise<void>} [options.openUri] - for tests
     * @param {(uri: string, cancellable: Gio.Cancellable) => Promise<boolean>} [options.exists] - for tests
     * @param {(uri: string, cancellable: Gio.Cancellable) => Promise<Array<{id: string, name: string, isDefault: boolean, launch: (uri: string) => void}>>} [options.appsFor] - for tests
     */
    constructor({openConnection = openLocalSearch, openUri: open = openUri, exists = uriExists, appsFor = appsForUri} = {}) {
        super();
        this.#openConnection = openConnection;
        this.#open = open;
        this.#exists = exists;
        this.#appsFor = appsFor;
    }

    get id() {
        return 'files';
    }

    get name() {
        const _ = this.#gettext ?? (text => text);
        return _('Files');
    }

    get priority() {
        return 20;
    }

    // A file that matches as well as an application is less likely to be what
    // the user is after: applications come first.
    get scoreWeight() {
        return 0.9;
    }

    get debounceMs() {
        return 50;
    }

    get timeoutMs() {
        return 400;
    }

    get maxResults() {
        return this.#settings ? this.#settings.get_int('max-results') : 6;
    }

    async init({settings, log, gettext}) {
        this.#settings = settings;
        this.#log = log;
        this.#gettext = gettext;
    }

    destroy() {
        this.#destroyed = true;
        this.#lifetime.cancel();
        const connection = this.#connection;
        this.#connection = null;
        if (!connection)
            return;
        // A search closes its cursor before it settles, in success or failure.
        Promise.allSettled([...this.#running]).then(() => {
            connection.close_async(null, (source, result) => {
                try {
                    source.close_finish(result);
                } catch (error) {
                    this.#log?.warn(`could not close the file index connection: ${error.message}`);
                }
            });
        });
    }

    async search(query, options) {
        // Registered before anything is awaited, so destroy() cannot miss it.
        const search = this.#search(query, options);
        this.#running.add(search);
        try {
            return await search;
        } finally {
            this.#running.delete(search);
        }
    }

    async #search(query, {cancellable}) {
        const terms = buildFtsTerms(query);
        if (!terms)
            return [];
        const connection = await this.#connect();
        if (!connection || this.#destroyed || cancellable.is_cancelled())
            return [];

        const rows = await runQuery(connection, terms, cancellable);
        return rowsToResults(rows, {
            home: GLib.get_home_dir(),
            excludedFolders: this.#settings.get_strv('excluded-folders'),
            excludedTypes: this.#settings.get_strv('excluded-types'),
            iconFor: iconForName,
        });
    }

    // Only a local file or folder that is still there is opened: the index may be out of date,
    // and nothing but a path on this machine may be handed to the system.
    async #openChecked(uri) {
        if (!isLocalFileUri(uri))
            throw new Error('refusing to open an address that is not a local file');
        if (!await this.#exists(uri, this.#lifetime))
            throw new Error('the file is no longer there');
        await this.#open(uri, this.#lifetime);
    }

    async activate(result) {
        await this.#openChecked(result.data.url);
    }

    secondaryActions(_result) {
        const _ = this.#gettext;
        return [{id: 'open-folder', label: _('Show in Folder')}];
    }

    /** The file to show in the previewer: a local file that is still there, or null. */
    async previewUri(result) {
        const url = result.data?.url;
        if (!isLocalFileUri(url) || !await this.#exists(url, this.#lifetime))
            return null;
        return url;
    }

    /** The menu actions of a file, besides Open. */
    async actions(result) {
        return fileActionList(result.data?.url, this.#gettext);
    }

    /** What "Open With" leads to: the applications that can open this file. */
    async subActions(result, action) {
        const url = result.data?.url;
        if (action.id !== 'open-with' || !isLocalFileUri(url))
            return [];
        return openWithActions(await this.#appsFor(url, this.#lifetime), this.#gettext);
    }

    async activateAction(result, action) {
        if (action.id === 'open-folder') {
            await this.#openChecked(result.data.parentUrl);
        } else if (action.id.startsWith(OPEN_WITH_PREFIX)) {
            // The file must still be there, and the application one of those that can open it:
            // an identifier is never trusted on its own.
            const url = result.data.url;
            if (!isLocalFileUri(url))
                throw new Error('refusing to open an address that is not a local file');
            if (!await this.#exists(url, this.#lifetime))
                throw new Error('the file is no longer there');
            const app = (await this.#appsFor(url, this.#lifetime)).find(candidate => `${OPEN_WITH_PREFIX}${candidate.id}` === action.id);
            if (!app)
                throw new Error('that application cannot open this file');
            app.launch(url);
        } else {
            throw new Error(`unknown action ${action.id}`);
        }
    }

    // One connection, opened on demand and shared by searches that overlap. If it
    // cannot be opened the failed attempt is kept, so there is no retry per keystroke.
    async #connect() {
        if (this.#connection || this.#destroyed)
            return this.#connection;
        if (!this.#connecting) {
            this.#connecting = this.#openConnection(this.#lifetime).then(connection => {
                if (this.#destroyed) {
                    connection.close_async(null, () => {});
                    return null;
                }
                this.#connection = connection;
                return connection;
            }, error => {
                this.#log.warn(`file search is unavailable: ${error.message}`);
                return null;
            });
        }
        return this.#connecting;
    }
}
