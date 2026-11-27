// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// What the bar under the results says about the chosen result: what Enter does, Space when it
// previews, and Ctrl+K when the result has a menu of actions. Pure; the window draws it.

// The sources whose results have more to offer than Enter (their menu of actions).
const WITH_ACTIONS = new Set(['apps', 'files', 'folders', 'calc']);

/**
 * @param {{providerId: string, result: {completesTo?: string, data?: {folder?: boolean}}} | null} item
 * @param {object} options
 * @param {boolean} options.canPreview - Space previews this result
 * @param {(text: string) => string} options.gettext
 * @returns {Array<{label: string, key: string}>} nothing when no result is chosen
 */
export function helpItems(item, {canPreview, gettext}) {
    if (!item?.result)
        return [];
    const _ = gettext;
    // A type of file to choose ("/pdf "): Enter (or Tab) puts it in the field.
    if (typeof item.result.completesTo === 'string')
        return [{label: _('Choose'), key: _('Enter')}];
    let open = _('Open');
    if (item.providerId === 'calc')
        open = _('Copy Result');
    else if (item.result.data?.folder === true)
        open = _('Open in Files');
    const list = [{label: open, key: _('Enter')}];
    if (canPreview)
        list.push({label: _('Preview'), key: _('Space')});
    if (WITH_ACTIONS.has(item.providerId))
        list.push({label: _('Actions'), key: _('Ctrl+K')});
    return list;
}
