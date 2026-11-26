// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Provider} from '../core/provider.js';
import {ACTION_PREFIX, actionResults, KNOWN_ACTIONS, PANEL_PREFIX, panelResults} from '../core/system-items.js';

// The panels of the Settings application are desktop files that are not listed as applications.
const PANEL_FILE = /^gnome-[a-z0-9-]+-panel\.desktop$/;

/** The shell's own list of actions (lock, power off...), whose names and availability it keeps. */
async function shellSystemActions() {
    const module = await import('resource:///org/gnome/shell/misc/systemActions.js');
    return module.getDefault();
}

/** The panels installed on this machine: [{id, name, keywords, icon, launch()}]. */
function installedPanels() {
    const panels = [];
    for (const info of Gio.AppInfo.get_all()) {
        const id = info.get_id();
        if (typeof id !== 'string' || !PANEL_FILE.test(id))
            continue;
        panels.push({
            id,
            name: info.get_name(),
            keywords: info.get_keywords?.() ?? [],
            icon: info.get_icon(),
            launch: () => info.launch([], null),
        });
    }
    return panels;
}

/**
 * What the system itself offers: its actions (lock the screen, power off, suspend...), asked of
 * the shell, which knows which exist here and confirms the drastic ones with its own dialog, and
 * the panels of Settings. Luciole reads no setting: it only asks for an action or opens a panel.
 */
export class SystemProvider extends Provider {
    #gettext = null;
    #log = null;
    #actionsOf;
    #panelsOf;
    #actions = null;
    #panels = [];

    /**
     * @param {object} [options] - for tests
     * @param {() => Promise<object>} [options.systemActions] - the shell's action list
     * @param {() => Array<object>} [options.panels] - the installed Settings panels
     */
    constructor({systemActions = shellSystemActions, panels = installedPanels} = {}) {
        super();
        this.#actionsOf = systemActions;
        this.#panelsOf = panels;
    }

    get id() {
        return 'system';
    }

    get name() {
        const _ = this.#gettext ?? (text => text);
        return _('System');
    }

    // After the applications and the files; never the top hit.
    get priority() {
        return 25;
    }

    get topHitEligible() {
        return false;
    }

    get maxResults() {
        return 4;
    }

    get timeoutMs() {
        return 100;
    }

    async init({gettext, log}) {
        this.#gettext = gettext;
        this.#log = log;
        this.#panels = this.#panelsOf();
        try {
            this.#actions = await this.#actionsOf();
        } catch (error) {
            // Without the shell's list there are still the panels.
            this.#log.warn(`the system actions are not available: ${error.message}`);
        }
    }

    destroy() {
        this.#actions = null;
        this.#panels = [];
    }

    async search(query) {
        const _ = this.#gettext;
        const results = panelResults(this.#panels, _);
        if (this.#actions) {
            const [terms] = GLib.str_tokenize_and_fold(query, null);
            const ids = terms?.length ? this.#actions.getMatchingActions(terms) : [];
            results.push(...actionResults(ids.map(id => ({
                id,
                name: this.#actions.getName(id),
                iconName: this.#actions.getIconName(id),
            })), _));
        }
        return results;
    }

    async activate(result) {
        const {kind, action, panel} = result.data ?? {};
        if (kind === 'action' && KNOWN_ACTIONS.has(action) && result.id === `${ACTION_PREFIX}${action}`) {
            // The shell checks again that the action is available, and confirms the drastic ones.
            if (!this.#actions)
                throw new Error('the system actions are not available');
            this.#actions.activateAction(action);
        } else if (kind === 'panel' && typeof panel === 'string' && result.id === `${PANEL_PREFIX}${panel}`) {
            const known = this.#panels.find(candidate => candidate.id === panel);
            if (!known)
                throw new Error(`the settings panel ${panel} is not installed`);
            known.launch();
        } else {
            throw new Error('unknown system item');
        }
    }
}
