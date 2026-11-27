// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// The pure side of the files provider: what the user typed becomes a safe
// full-text query, and what the index returns becomes results. Nothing here
// touches the index, so it is all tested without it.

const MAX_WORDS = 5;
const MIN_WORD_LENGTH = 2;

/**
 * Turns what the user typed into a full-text query: every word becomes a
 * prefix ("annual rep" gives "annual* rep*"). Only letters and digits survive,
 * so query operators, quotes and wildcards typed by the user are never passed
 * on. The result is handed to the index as a bound value, never inserted in
 * the SPARQL text.
 *
 * @param {string} raw
 * @returns {string | null} null when there is nothing worth searching for
 */
export function buildFtsTerms(raw) {
    const words = (raw.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, MAX_WORDS);
    if (words.length === 0 || Math.max(...words.map(word => word.length)) < MIN_WORD_LENGTH)
        return null;
    return words.map(word => `${word}*`).join(' ');
}

/**
 * Whether an address is a plain local file or folder: "file:///" and a path, nothing else. A
 * host ("file://server/share"), another scheme, or an address with a query or fragment is not,
 * so nothing but a path on this machine is ever handed to the system to open.
 */
export function isLocalFileUri(uri) {
    // eslint-disable-next-line no-control-regex -- control characters are what is looked for
    return typeof uri === 'string' && /^file:\/\/\/[^?#]*$/.test(uri) && !/[\u0000-\u001f\u007f]/.test(uri);
}

/** "file:///home/me/Documents/a%20b.odt" -> "/home/me/Documents/a b.odt". */
export function pathOfUrl(url) {
    try {
        return decodeURIComponent(url.replace(/^file:\/\//, ''));
    } catch {
        return url.replace(/^file:\/\//, '');
    }
}

/** The folder of a file, with the home directory shown as "~". */
export function displayFolder(url, home) {
    const path = pathOfUrl(url);
    const folder = path.slice(0, Math.max(0, path.lastIndexOf('/'))) || '/';
    if (home && (folder === home || folder.startsWith(`${home}/`)))
        return `~${folder.slice(home.length)}`;
    return folder;
}

/** URL of the folder that contains a file. */
export function parentUrl(url) {
    return url.slice(0, Math.max('file://'.length, url.lastIndexOf('/')));
}

/**
 * Folders and files left out of the results.
 *
 * A rule with a "/" is a path (a leading "~" is the home directory) and covers
 * everything below it; a rule without one is a name that excludes any folder
 * or file called so, wherever it is. Hidden files and folders (names starting
 * with a dot) are always left out.
 *
 * @param {string} url
 * @param {string[]} rules
 * @param {string} home
 */
export function isExcluded(url, rules, home) {
    const path = pathOfUrl(url);
    const segments = path.split('/').filter(segment => segment !== '');
    if (segments.some(segment => segment.startsWith('.')))
        return true;
    for (const rule of rules) {
        if (!rule)
            continue;
        if (rule.includes('/')) {
            const prefix = (rule.startsWith('~') ? home + rule.slice(1) : rule).replace(/\/+$/, '');
            if (path === prefix || path.startsWith(`${prefix}/`))
                return true;
        } else if (segments.includes(rule)) {
            return true;
        }
    }
    return false;
}

/** File types left out, written as extensions: ".tmp", "*.o" or "log". */
export function isExcludedType(name, types) {
    const lower = name.toLowerCase();
    return types.some(type => {
        const extension = type.toLowerCase().replace(/^\*?\.?/, '');
        return extension !== '' && lower.endsWith(`.${extension}`);
    });
}

/**
 * @typedef {object} FileRow
 * @property {string} url
 * @property {string} name
 * @property {string} [modified] - ISO date
 * @property {number} rank - full-text relevance, any positive number
 */

/**
 * Builds results from index rows. The relevance is rescaled to 0..1 against the
 * best row, so it can be mixed with the name match.
 *
 * @param {FileRow[]} rows
 * @param {object} options
 * @param {string} options.home
 * @param {string[]} [options.excludedFolders]
 * @param {string[]} [options.excludedTypes]
 * @param {(name: string) => unknown} [options.iconFor]
 * @param {string} [options.source] - the source's id, for what it remembers of a result
 * @returns {import('../core/provider.js').Result[]}
 */
export function rowsToResults(rows, {home, excludedFolders = [], excludedTypes = [], iconFor = () => undefined, source = 'files'}) {
    const kept = rows.filter(row =>
        row.url && row.name &&
        !isExcluded(row.url, excludedFolders, home) &&
        !isExcludedType(row.name, excludedTypes));
    const best = Math.max(0, ...kept.map(row => row.rank));
    const seen = new Set();
    const results = [];
    for (const row of kept) {
        if (seen.has(row.url))
            continue;
        seen.add(row.url);
        const folder = row.folder === true;
        results.push({
            id: row.url,
            title: row.name,
            subtitle: displayFolder(row.url, home),
            icon: folder ? FOLDER_ICON : iconFor(row.name),
            providerScore: best > 0 ? row.rank / best : 1,
            frecencyKey: `${source}:${row.url}`,
            dedupeKey: row.url,
            data: {url: row.url, parentUrl: parentUrl(row.url), folder},
            // A local file can be shown in GNOME's previewer; a folder is opened instead.
            previewable: !folder && isLocalFileUri(row.url),
        });
    }
    return results;
}

export const OPEN_WITH_PREFIX = 'open-with:';
// The theme's icon for a folder, as Files shows it.
export const FOLDER_ICON = 'folder';
const MAX_OPEN_WITH = 12;

/** The last part of a path or an address, decoded: "file:///a/b%20c.odt" -> "b c.odt". */
export function baseName(url) {
    const path = pathOfUrl(url).replace(/\/+$/, '');
    return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * The actions offered for a file or a folder, besides "Open" (which every result has). Only a local
 * one has any: nothing else can be copied as a path or handed to an application. A folder is not
 * previewed (it is opened), and is shown in the folder that holds it.
 *
 * @param {string} url
 * @param {(text: string) => string} gettext
 * @param {{folder?: boolean}} [options]
 */
export function fileActionList(url, gettext, {folder = false} = {}) {
    if (!isLocalFileUri(url))
        return [];
    const _ = gettext;
    if (folder) {
        return [
            {id: 'open-folder', label: _('Show in Parent Folder'), hint: _('Ctrl+Enter')},
            {id: 'copy-path', label: _('Copy Path'), copy: pathOfUrl(url), confirmation: _('Path copied')},
            {id: 'copy-name', label: _('Copy Name'), copy: baseName(url), confirmation: _('Name copied')},
            {id: 'open-with', label: _('Open With…'), submenu: true},
        ];
    }
    return [
        {id: 'open-folder', label: _('Show in Folder'), hint: _('Ctrl+Enter')},
        {id: 'preview', label: _('Preview'), hint: _('Space')},
        {id: 'copy-path', label: _('Copy Path'), copy: pathOfUrl(url), confirmation: _('Path copied')},
        {id: 'copy-name', label: _('Copy Name'), copy: baseName(url), confirmation: _('Name copied')},
        {id: 'open-with', label: _('Open With…'), submenu: true},
    ];
}

/**
 * The applications that can open a file, as menu actions: the default one first, then the others
 * in the order given, at most MAX_OPEN_WITH.
 *
 * @param {Array<{id: string, name: string, isDefault?: boolean}>} apps
 * @param {(text: string) => string} gettext
 */
export function openWithActions(apps, gettext) {
    if (!Array.isArray(apps))
        return [];
    const usable = apps.filter(app => app && typeof app.id === 'string' && app.id !== '' && typeof app.name === 'string' && app.name !== '');
    const ordered = [...usable.filter(app => app.isDefault === true), ...usable.filter(app => app.isDefault !== true)];
    return ordered.slice(0, MAX_OPEN_WITH).map(app => {
        const action = {id: `${OPEN_WITH_PREFIX}${app.id}`, label: app.name};
        if (app.isDefault === true)
            action.hint = gettext('Default');
        return action;
    });
}
