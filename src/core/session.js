// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';

import {cleanActions} from './action-menu.js';
import {categoriesOf, effectiveFilter} from './categories.js';
import {createMatcher} from './matching.js';
import {mergeResults} from './merge.js';
import {scoreForEmptyQuery, scoreResult} from './scoring.js';
import {sanitizeLabel} from './text.js';

const TIMED_OUT = Symbol('timed out');

function isCancelledError(error) {
    try {
        return error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) === true;
    } catch {
        return false;
    }
}

/**
 * What a provider returned, made safe to show: unsafe characters out of every text the user can
 * see or that is matched (see sanitizeLabel). A result that is already clean comes back as it
 * is, with no copy; one left with no title is dropped (null).
 */
function cleanResult(result) {
    const title = sanitizeLabel(result.title);
    if (title === '')
        return null;
    const subtitle = typeof result.subtitle === 'string' ? sanitizeLabel(result.subtitle) : result.subtitle;
    let fields = result.matchFields;
    let fieldsChanged = false;
    if (Array.isArray(fields)) {
        fields = fields.map(field => {
            const raw = typeof field === 'string' ? field : field?.text;
            const text = sanitizeLabel(raw);
            if (text === raw)
                return field;
            fieldsChanged = true;
            // A text that changed no longer matches the folded form computed for the old one.
            return typeof field === 'string' ? text : {...field, text, folded: undefined};
        }).filter(field => (typeof field === 'string' ? field : field?.text) !== '');
    }
    if (title === result.title && subtitle === result.subtitle && !fieldsChanged)
        return result;
    return {...result, title, subtitle, matchFields: fields};
}

function isUsableResult(result) {
    return result && typeof result.id === 'string' && typeof result.title === 'string';
}

/**
 * Runs searches over all providers.
 *
 * Every keystroke starts a new search and cancels the previous one. Providers
 * run in parallel; each has its own delay, its own cancellable and its own
 * error barrier, so a slow or failing provider never delays or breaks the
 * others. Results are shown as they arrive.
 *
 * Time comes from an injected scheduler, so tests can drive it by hand:
 *   now(): number                        milliseconds since the epoch
 *   sleep(ms, cancellable): Promise      resolves after ms, or when cancelled
 *   timeout(ms): {promise, cancel()}     promise resolves after ms
 *   nextFrame(fn): () => void            runs fn soon (about one frame); returns a cancel function
 */
export class SearchController {
    #getProviders;
    #frecency;
    #scheduler;
    #log;
    #onUpdate;
    #onFrecencyChange;
    #queryHistory;
    #rememberQueries;
    #onQueryHistoryChange;
    #gettext;
    #copyText;
    #mergeOptions;

    #cancellable = null;
    #cancelFrame = null;
    #scored = new Map();
    #emptyQuery = true;
    #query = '';
    #filter = null;

    /**
     * @param {object} options
     * @param {() => import('./provider.js').Provider[]} options.getProviders
     * @param {import('./frecency.js').Frecency} options.frecency
     * @param {object} options.scheduler
     * @param {object} options.log
     * @param {(merged: ReturnType<typeof mergeResults>, state: {done: boolean}) => void} options.onUpdate
     * @param {() => void} [options.onFrecencyChange]
     * @param {import('./query-history.js').QueryHistory} [options.queryHistory] - where useful searches are remembered
     * @param {() => boolean} [options.rememberQueries] - asked at each use: whether searches may be remembered now
     * @param {() => void} [options.onQueryHistoryChange]
     * @param {(text: string) => string} [options.gettext] - for the texts the controller adds itself
     * @param {(text: string) => void} [options.copyText] - puts a text on the clipboard
     * @param {object} [options.mergeOptions]
     */
    constructor({getProviders, frecency, scheduler, log, onUpdate, onFrecencyChange = () => {}, queryHistory = null, rememberQueries = () => false, onQueryHistoryChange = () => {}, gettext = text => text, copyText = () => {}, mergeOptions = {}}) {
        this.#getProviders = getProviders;
        this.#frecency = frecency;
        this.#scheduler = scheduler;
        this.#log = log;
        this.#onUpdate = onUpdate;
        this.#onFrecencyChange = onFrecencyChange;
        this.#queryHistory = queryHistory;
        this.#rememberQueries = rememberQueries;
        this.#onQueryHistoryChange = onQueryHistoryChange;
        this.#gettext = gettext;
        this.#copyText = copyText;
        this.#mergeOptions = mergeOptions;
    }

    /** One category per source, for the window to offer; none when there is nothing to choose between. */
    categories() {
        return categoriesOf(this.#getProviders());
    }

    /**
     * Restricts the searches to one source (its id), or to all of them (null). The caller runs
     * the search again. A source that is gone counts as all.
     */
    setFilter(id) {
        this.#filter = typeof id === 'string' ? id : null;
    }

    // The sources a search goes to: the chosen one, or all of them.
    #searched() {
        const providers = this.#getProviders();
        const only = effectiveFilter(this.#filter, providers);
        return only === null ? providers : providers.filter(provider => provider.id === only);
    }

    /**
     * Starts a search and cancels the previous one. The returned promise
     * resolves once every provider has finished or been given up on.
     *
     * @param {string} rawQuery
     * @returns {Promise<void>}
     */
    search(rawQuery) {
        this.#cancelCurrent();
        const cancellable = new Gio.Cancellable();
        this.#cancellable = cancellable;
        this.#scored = new Map();

        const query = rawQuery.trim();
        this.#query = query;
        const matcher = createMatcher(query);
        this.#emptyQuery = matcher.isEmpty;
        const alive = () => !cancellable.is_cancelled();

        const runs = this.#searched().map(provider =>
            this.#run(provider, query, matcher, alive, cancellable));
        return Promise.all(runs).then(() => {
            if (!alive())
                return;
            this.#cancelPendingFrame();
            this.#publish(true);
        });
    }

    /** Runs the chosen item and remembers it for frecency. Resolves to whether it worked. */
    async activate(item, options = {}) {
        const provider = this.#getProviders().find(p => p.id === item.providerId);
        if (!provider)
            return false;
        const query = this.#query;
        const done = await this.#log.guardAsync(`activating ${item.key}`, async () => {
            await provider.activate(item.result, options);
            return true;
        }, false);
        if (done && item.result.frecencyKey) {
            this.#frecency.record(item.result.frecencyKey, this.#scheduler.now());
            this.#onFrecencyChange();
        }
        if (done)
            this.#rememberQuery(query);
        return done;
    }

    // A search is kept only once it led somewhere, and only while the user allows it.
    #rememberQuery(query) {
        if (!this.#queryHistory || query === '')
            return;
        const allowed = this.#log.guard('reading the remember-searches setting', () => this.#rememberQueries(), false);
        if (!allowed)
            return;
        this.#queryHistory.record(query);
        this.#onQueryHistoryChange();
    }

    /**
     * The actions of a result, for its menu: always "Open" first, then what its source offers.
     * What a source hands over is checked (see cleanActions); a source that fails offers only Open.
     *
     * @returns {Promise<Array<object>>}
     */
    async actionsFor(item) {
        const provider = this.#getProviders().find(p => p.id === item.providerId);
        const _ = this.#gettext;
        const open = {id: 'open', label: _('Open'), hint: _('Enter')};
        if (!provider?.actions)
            return [open];
        const offered = await this.#log.guardAsync(`listing the actions of ${item.key}`,
            () => provider.actions(item.result), []);
        const rest = cleanActions(offered).filter(action => action.id !== 'open');
        return [open, ...rest];
    }

    /** What a submenu action ("Open With") leads to. An empty list when there is nothing. */
    async subActionsFor(item, action) {
        const provider = this.#getProviders().find(p => p.id === item.providerId);
        if (!provider?.subActions || !action?.submenu)
            return [];
        const offered = await this.#log.guardAsync(`listing ${action.id} for ${item.key}`,
            () => provider.subActions(item.result, action), []);
        return cleanActions(offered).filter(candidate => !candidate.submenu);
    }

    /**
     * Runs one action of a result's menu. Resolves to {ok, confirmation}: whether it worked, and the
     * text to show for a copy. Copying only writes to the clipboard.
     *
     * @returns {Promise<{ok: boolean, confirmation: string | null}>}
     */
    async runAction(item, action) {
        const none = {ok: false, confirmation: null};
        if (!action || typeof action.id !== 'string')
            return none;
        if (typeof action.copy === 'string') {
            const copied = this.#log.guard(`copying for ${item.key}`, () => {
                this.#copyText(action.copy);
                return true;
            }, false);
            return {ok: copied, confirmation: copied ? action.confirmation ?? null : null};
        }
        if (action.id === 'open')
            return {ok: await this.activate(item), confirmation: null};
        const provider = this.#getProviders().find(p => p.id === item.providerId);
        if (!provider?.activateAction)
            return none;
        const query = this.#query;
        const ok = await this.#log.guardAsync(`action ${action.id} on ${item.key}`, async () => {
            await provider.activateAction(item.result, action);
            return true;
        }, false);
        if (ok) {
            this.#log.debug(`action ${action.id} on ${item.key} done`);
            this.#rememberQuery(query);
        }
        return {ok, confirmation: null};
    }

    /**
     * Runs the first secondary action of an item (for a file: show its folder).
     * Resolves to whether there was one and it worked.
     */
    async activateSecondary(item) {
        const provider = this.#getProviders().find(p => p.id === item.providerId);
        const [action] = provider?.secondaryActions?.(item.result) ?? [];
        if (!action)
            return false;
        const query = this.#query;
        const done = await this.#log.guardAsync(`action ${action.id} on ${item.key}`, async () => {
            await provider.activateAction(item.result, action);
            return true;
        }, false);
        if (done)
            this.#rememberQuery(query);
        return done;
    }

    /** Cancels everything in flight. Results that arrive afterwards are ignored. */
    dispose() {
        this.#cancelCurrent();
    }

    async #run(provider, query, matcher, alive, parent) {
        // Own cancellable: a timeout stops this provider only.
        const own = new Gio.Cancellable();
        // Gio.Cancellable.connect() takes the callback only (no signal name); it runs at once if already cancelled.
        const link = parent.connect(() => own.cancel());
        let timer = null;
        try {
            if (!matcher.isEmpty && provider.debounceMs > 0) {
                await this.#scheduler.sleep(provider.debounceMs, parent);
                if (!alive())
                    return;
            }
            const options = {
                cancellable: own,
                limit: provider.maxResults,
                emit: batch => {
                    if (alive())
                        this.#accept(provider, batch, matcher);
                },
            };
            const work = matcher.isEmpty
                ? provider.emptyQueryResults(options)
                : provider.search(query, options);
            timer = this.#scheduler.timeout(provider.timeoutMs);
            const outcome = await Promise.race([work, timer.promise.then(() => TIMED_OUT)]);
            if (outcome === TIMED_OUT) {
                own.cancel();
                if (alive())
                    this.#log.warn(`provider "${provider.id}" gave no answer within ${provider.timeoutMs} ms`);
                return;
            }
            if (alive())
                this.#accept(provider, outcome, matcher);
        } catch (error) {
            if (alive() && !isCancelledError(error))
                this.#log.error(`provider "${provider.id}" failed`, error);
        } finally {
            timer?.cancel();
            parent.disconnect(link);
        }
    }

    #accept(provider, batch, matcher) {
        if (!Array.isArray(batch)) {
            if (batch !== undefined && batch !== null)
                this.#log.warn(`provider "${provider.id}" returned something that is not a list`);
            return;
        }
        const now = this.#scheduler.now();
        let store = this.#scored.get(provider.id);
        if (!store) {
            store = new Map();
            this.#scored.set(provider.id, store);
        }
        for (const received of batch) {
            if (!isUsableResult(received)) {
                this.#log.warn(`provider "${provider.id}" returned a result without id or title`);
                continue;
            }
            const result = cleanResult(received);
            if (!result) {
                this.#log.warn(`provider "${provider.id}" returned a result with nothing to show as its title`);
                continue;
            }
            const scored = matcher.isEmpty
                ? scoreForEmptyQuery(result, this.#frecency, now)
                : scoreResult(result, matcher, this.#frecency, now);
            if (scored) {
                const weight = provider.scoreWeight ?? 1;
                store.set(result.id, {result, final: scored.final * weight, ranges: scored.ranges});
            }
        }
        this.#schedulePublish();
    }

    #schedulePublish() {
        if (this.#cancelFrame)
            return;
        this.#cancelFrame = this.#scheduler.nextFrame(() => {
            this.#cancelFrame = null;
            this.#publish(false);
        });
    }

    #publish(done) {
        const entries = this.#searched().map(provider => ({
            provider,
            scored: [...(this.#scored.get(provider.id)?.values() ?? [])],
        }));
        const merged = mergeResults(entries, {...this.#mergeOptions, topHit: !this.#emptyQuery && effectiveFilter(this.#filter, this.#getProviders()) === null});
        this.#log.guard('updating the results', () => this.#onUpdate(merged, {done}));
    }

    #cancelPendingFrame() {
        this.#cancelFrame?.();
        this.#cancelFrame = null;
    }

    #cancelCurrent() {
        this.#cancelPendingFrame();
        this.#cancellable?.cancel();
        this.#cancellable = null;
    }
}
