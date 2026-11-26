// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// What the "System" source shows: the actions the shell offers (lock the screen, power off...)
// and the panels of the Settings application. The shell and the desktop files say what exists
// and give the names, already translated; this turns that into results. Pure functions.

// The shell's own identifiers for the actions it offers; nothing else is ever asked of it.
export const KNOWN_ACTIONS = new Set(['power-off', 'restart', 'lock-screen', 'logout', 'suspend', 'switch-user', 'lock-orientation', 'open-screenshot-ui']);

// Actions that end or interrupt the session. They are never selected for the user and never the
// top hit; the shell asks for a confirmation for most of them as well.
export const DESTRUCTIVE_ACTIONS = new Set(['power-off', 'restart', 'logout', 'suspend', 'switch-user']);
// The ones the shell confirms with its own dialog (with a Cancel button).
const CONFIRMED_BY_SHELL = new Set(['power-off', 'restart', 'logout']);

export const ACTION_PREFIX = 'action:';
export const PANEL_PREFIX = 'panel:';
const PANEL_ID = /^gnome-[a-z0-9-]+-panel\.desktop$/;

/**
 * Results for the shell's own actions.
 *
 * @param {Array<{id: string, name: string, iconName?: string}>} actions - the ones available now
 * @param {(text: string) => string} gettext
 */
export function actionResults(actions, gettext) {
    if (!Array.isArray(actions))
        return [];
    const _ = gettext;
    const results = [];
    for (const action of actions) {
        if (!KNOWN_ACTIONS.has(action?.id) || typeof action.name !== 'string' || action.name === '')
            continue;
        const destructive = DESTRUCTIVE_ACTIONS.has(action.id);
        results.push({
            id: `${ACTION_PREFIX}${action.id}`,
            title: action.name,
            subtitle: CONFIRMED_BY_SHELL.has(action.id) ? `${_('System action')} · ${_('asks for confirmation')}` : _('System action'),
            icon: typeof action.iconName === 'string' ? action.iconName : undefined,
            matchFields: [action.name],
            // The shell already chose these by its own keywords: they match, whatever the title says.
            providerScore: 0.8,
            // The window closes first, so the shell's dialog does not compete with its grab.
            closeBeforeActivate: true,
            ...(destructive ? {explicitSelectionOnly: true} : {}),
            data: {kind: 'action', action: action.id},
        });
    }
    return results;
}

/**
 * Results for the panels of the Settings application.
 *
 * @param {Array<{id: string, name: string, keywords?: string[], icon?: unknown}>} panels
 * @param {(text: string) => string} gettext
 */
export function panelResults(panels, gettext) {
    if (!Array.isArray(panels))
        return [];
    const results = [];
    for (const panel of panels) {
        if (typeof panel?.id !== 'string' || !PANEL_ID.test(panel.id) || typeof panel.name !== 'string' || panel.name === '')
            continue;
        const keywords = Array.isArray(panel.keywords) ? panel.keywords.filter(keyword => typeof keyword === 'string' && keyword !== '') : [];
        results.push({
            id: `${PANEL_PREFIX}${panel.id}`,
            title: panel.name,
            subtitle: gettext('Settings'),
            icon: panel.icon,
            // The name counts fully, the keywords a little less.
            matchFields: [panel.name, ...keywords.map(text => ({text, weight: 0.7}))],
            closeBeforeActivate: true,
            data: {kind: 'panel', panel: panel.id},
        });
    }
    return results;
}
