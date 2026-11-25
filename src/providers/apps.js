// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import Shell from 'gi://Shell';

import {Disposables} from '../core/disposables.js';
import {Provider} from '../core/provider.js';
import {buildAppResults, pickByIds} from './apps-index.js';

function describe(info) {
    // Keywords and generic names exist on desktop app infos only.
    return {
        id: info.get_id(),
        name: info.get_name(),
        genericName: info.get_generic_name?.() ?? null,
        keywords: info.get_keywords?.() ?? [],
        description: info.get_description(),
        icon: info.get_icon(),
    };
}

/**
 * Installed applications, Flatpak ones included (the shell's application
 * system lists them all). The index lives in memory and is rebuilt lazily
 * after the shell reports that applications were installed or removed.
 */
export class AppsProvider extends Provider {
    #results = [];
    #dirty = true;
    #disposables = new Disposables();
    #system = null;
    #frecency = null;
    #settings = null;
    #log = null;
    #gettext = null;

    get id() {
        return 'apps';
    }

    get name() {
        const _ = this.#gettext ?? (text => text);
        return _('Applications');
    }

    get priority() {
        return 10;
    }

    get maxResults() {
        return this.#settings ? this.#settings.get_int('max-results') : 8;
    }

    get timeoutMs() {
        return 100;
    }

    async init({settings, frecency, log, gettext}) {
        this.#settings = settings;
        this.#frecency = frecency;
        this.#log = log;
        this.#gettext = gettext;
        this.#system = Shell.AppSystem.get_default();
        this.#disposables.connect(this.#system, 'installed-changed', () => {
            this.#dirty = true;
            this.#log.debug('installed applications changed');
        });
        this.#rebuild();
    }

    destroy() {
        this.#disposables.dispose();
        this.#results = [];
        this.#system = null;
    }

    async search() {
        this.#refresh();
        return this.#results;
    }

    /** The most used applications, for an empty query. */
    async emptyQueryResults({limit}) {
        this.#refresh();
        const keys = this.#frecency.top('apps:', limit, Date.now());
        return pickByIds(this.#results, keys.map(key => key.slice('apps:'.length)));
    }

    async activate(result) {
        const app = this.#system?.lookup_app(result.id);
        if (!app)
            throw new Error(`application ${result.id} is no longer installed`);
        app.activate();
    }

    #refresh() {
        if (this.#dirty)
            this.#rebuild();
    }

    #rebuild() {
        const descriptors = [];
        for (const info of this.#system.get_installed()) {
            try {
                if (info.should_show())
                    descriptors.push(describe(info));
            } catch (error) {
                // A desktop file with an invalid encoding must not hide the others.
                this.#log.warn(`an application could not be read: ${error.message}`);
            }
        }
        this.#results = buildAppResults(descriptors);
        this.#dirty = false;
        this.#log.debug(`apps index: ${this.#results.length} applications`);
    }
}
