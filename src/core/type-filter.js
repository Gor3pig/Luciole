// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// "/pdf facture": a search restricted to one type of file. The types are a fixed list; what the
// user types after "/" only picks one of them and never reaches the index. A file's type comes from
// what the index knows (its MIME type) or, when the index does not know it, from its extension.

import {fold} from './text.js';

/**
 * The types, in the order the suggestions show them. `names` are what can follow "/" (French and
 * English, folded); the first one is the one shown.
 */
export const FILE_TYPES = [
    {id: 'images', names: ['images', 'image', 'photos', 'photo'], mime: ['image/'],
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tif', 'tiff', 'heic', 'avif']},
    {id: 'documents', names: ['documents', 'document', 'docs', 'doc'],
        mime: ['application/pdf', 'application/vnd.oasis.opendocument.', 'application/msword', 'application/vnd.openxmlformats-officedocument.', 'application/vnd.ms-', 'application/rtf'],
        extensions: ['pdf', 'odt', 'ods', 'odp', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf']},
    {id: 'pdf', names: ['pdf'], mime: ['application/pdf'], extensions: ['pdf']},
    {id: 'text', names: ['texte', 'text', 'textes', 'texts'], mime: ['text/'],
        extensions: ['txt', 'md', 'markdown', 'csv', 'log', 'html', 'htm', 'xml', 'json', 'yaml', 'yml', 'ini', 'conf']},
    {id: 'folders', names: ['dossiers', 'dossier', 'folders', 'folder'], mime: ['inode/directory'], extensions: []},
    {id: 'music', names: ['musique', 'music', 'audio'], mime: ['audio/'], extensions: ['mp3', 'ogg', 'oga', 'flac', 'wav', 'm4a', 'opus', 'aac']},
    {id: 'videos', names: ['videos', 'video', 'films', 'film'], mime: ['video/'], extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'ogv', 'm4v']},
    {id: 'archives', names: ['archives', 'archive', 'zip'],
        mime: ['application/zip', 'application/x-tar', 'application/gzip', 'application/x-7z-compressed', 'application/x-rar', 'application/x-xz', 'application/x-bzip', 'application/zstd', 'application/x-compressed-tar'],
        extensions: ['zip', 'tar', 'gz', 'tgz', '7z', 'rar', 'xz', 'bz2', 'zst']},
];

const BY_ID = new Map(FILE_TYPES.map(type => [type.id, type]));
const BY_NAME = new Map(FILE_TYPES.flatMap(type => type.names.map(name => [name, type])));
const LEADING_TYPE = /^\/([\p{L}]+)(?:\s+([\s\S]*))?$/u;

/** The type a name after "/" stands for ("PDF", "Vidéos"), or null. */
export function typeNamed(name) {
    if (typeof name !== 'string' || name === '' || name.length > 20)
        return null;
    return BY_NAME.get(fold(name)) ?? null;
}

/**
 * What a query says about types:
 * - {type, text}: "/pdf facture" is a search for "facture" among PDF files (text may be '');
 * - {suggestions}: "/" or "/pd" alone is the beginning of a type, here are the matching ones;
 * - null: an ordinary search ("/etc/hosts", "notes").
 *
 * @param {string} query
 */
export function parseTypeQuery(query) {
    if (typeof query !== 'string')
        return null;
    const trimmed = query.trimStart();
    if (trimmed === '/')
        return {suggestions: FILE_TYPES.map(type => type.id)};
    const match = LEADING_TYPE.exec(trimmed);
    if (!match)
        return null;
    const [, word, rest] = match;
    const type = typeNamed(word);
    // "/pdf" alone: complete it, like any beginning; "/pdf ..." with a space: the type is chosen.
    if (rest === undefined) {
        const start = fold(word);
        const suggestions = FILE_TYPES.filter(candidate => candidate.names.some(name => name.startsWith(start))).map(candidate => candidate.id);
        if (suggestions.length > 0)
            return {suggestions};
        return null;
    }
    if (!type)
        return null;
    return {type: type.id, text: rest.trim()};
}

/** The extension of a file name, folded ("Photo.JPG" -> "jpg"), or ''. */
function extensionOf(name) {
    if (typeof name !== 'string')
        return '';
    const dot = name.lastIndexOf('.');
    return dot > 0 && dot < name.length - 1 ? fold(name.slice(dot + 1)) : '';
}

/**
 * Whether a file is of a type: by the MIME type the index knows, else by its extension.
 *
 * @param {string} typeId
 * @param {{mime?: string | null, name?: string}} file
 */
export function fileIsOfType(typeId, {mime, name} = {}) {
    const type = BY_ID.get(typeId);
    if (!type)
        return false;
    if (typeof mime === 'string' && mime !== '')
        return type.mime.some(prefix => mime === prefix || (prefix.endsWith('/') || prefix.endsWith('.') || prefix.endsWith('-') ? mime.startsWith(prefix) : false));
    const extension = extensionOf(name);
    return extension !== '' && type.extensions.includes(extension);
}

/** How the query is written once a type is chosen: "/pdf " plus the words. */
export function typePrefix(typeId) {
    const type = BY_ID.get(typeId);
    return type ? `/${type.names[0]} ` : '';
}

/** The names the types are shown under, translated. */
export function typeLabels(gettext) {
    const _ = gettext;
    return {
        images: _('Images'), documents: _('Documents'), pdf: _('PDF'), text: _('Text'),
        folders: _('Folders'), music: _('Music'), videos: _('Videos'), archives: _('Archives'),
    };
}
