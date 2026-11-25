// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {validateProvider} from './provider.js';

/**
 * Knows the available providers by identifier, and starts the enabled ones.
 * Providers are only instantiated by start(), never when they are registered:
 * nothing is created at load time.
 */
export class ProviderRegistry {
    #factories = new Map();
    #active = [];
    #log;

    constructor({log}) {
        this.#log = log;
    }

    /**
     * @param {string} id
     * @param {() => import('./provider.js').Provider} create
     */
    register(id, create) {
        if (this.#factories.has(id))
            throw new Error(`provider "${id}" is already registered`);
        this.#factories.set(id, create);
    }

    get ids() {
        return [...this.#factories.keys()];
    }

    /** Started providers, in the order they were asked for. */
    get providers() {
        return [...this.#active];
    }

    /**
     * Creates and initialises the providers in `enabledIds`, in that order. A
     * provider that fails is logged and skipped; the others still start.
     *
     * @param {object} context - handed to every provider's init()
     * @param {string[]} enabledIds
     */
    async start(context, enabledIds) {
        for (const id of enabledIds) {
            const create = this.#factories.get(id);
            if (!create) {
                this.#log.warn(`unknown provider "${id}" skipped`);
                continue;
            }
            let provider = null;
            try {
                provider = create();
                validateProvider(provider);
                await provider.init(context);
                this.#active.push(provider);
            } catch (error) {
                this.#log.error(`provider "${id}" could not start`, error);
                this.#destroyOne(provider);
            }
        }
    }

    /** Destroys the started providers, last started first. Safe to call twice. */
    stop() {
        while (this.#active.length > 0)
            this.#destroyOne(this.#active.pop());
    }

    #destroyOne(provider) {
        if (!provider || typeof provider.destroy !== 'function')
            return;
        try {
            provider.destroy();
        } catch (error) {
            this.#log.error(`provider "${provider.id}" failed to clean up`, error);
        }
    }
}
