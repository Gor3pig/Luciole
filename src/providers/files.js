import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Tracker from 'gi://Tracker';

import {Provider} from '../core/provider.js';
import {buildFtsTerms, rowsToResults} from './files-query.js';

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
    #connection = null;
    #connecting = null;
    #destroyed = false;
    #settings = null;
    #log = null;
    #gettext = null;
    #lifetime = new Gio.Cancellable();

    /**
     * @param {object} [options]
     * @param {(cancellable: Gio.Cancellable) => Promise<object>} [options.openConnection] - for tests
     * @param {(uri: string, cancellable: Gio.Cancellable) => Promise<void>} [options.openUri] - for tests
     */
    constructor({openConnection = openLocalSearch, openUri: open = openUri} = {}) {
        super();
        this.#openConnection = openConnection;
        this.#open = open;
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
        connection.close_async(null, (source, result) => {
            try {
                source.close_finish(result);
            } catch (error) {
                this.#log.warn(`could not close the file index connection: ${error.message}`);
            }
        });
    }

    async search(query, {cancellable}) {
        const terms = buildFtsTerms(query);
        if (!terms)
            return [];
        const connection = await this.#connect();
        if (!connection || cancellable.is_cancelled())
            return [];

        const rows = await runQuery(connection, terms, cancellable);
        return rowsToResults(rows, {
            home: GLib.get_home_dir(),
            excludedFolders: this.#settings.get_strv('excluded-folders'),
            excludedTypes: this.#settings.get_strv('excluded-types'),
            iconFor: iconForName,
        });
    }

    async activate(result) {
        await this.#open(result.data.url, this.#lifetime);
    }

    secondaryActions(_result) {
        const _ = this.#gettext;
        return [{id: 'open-folder', label: _('Show in Folder')}];
    }

    async activateAction(result, action) {
        if (action.id === 'open-folder')
            await this.#open(result.data.parentUrl, this.#lifetime);
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
