import Gio from 'gi://Gio';

import {createMatcher} from './matching.js';
import {mergeResults} from './merge.js';
import {scoreForEmptyQuery, scoreResult} from './scoring.js';

const TIMED_OUT = Symbol('timed out');

function isCancelledError(error) {
    try {
        return error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) === true;
    } catch {
        return false;
    }
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
    #mergeOptions;

    #cancellable = null;
    #cancelFrame = null;
    #scored = new Map();
    #emptyQuery = true;

    /**
     * @param {object} options
     * @param {() => import('./provider.js').Provider[]} options.getProviders
     * @param {import('./frecency.js').Frecency} options.frecency
     * @param {object} options.scheduler
     * @param {object} options.log
     * @param {(merged: ReturnType<typeof mergeResults>, state: {done: boolean}) => void} options.onUpdate
     * @param {() => void} [options.onFrecencyChange]
     * @param {object} [options.mergeOptions]
     */
    constructor({getProviders, frecency, scheduler, log, onUpdate, onFrecencyChange = () => {}, mergeOptions = {}}) {
        this.#getProviders = getProviders;
        this.#frecency = frecency;
        this.#scheduler = scheduler;
        this.#log = log;
        this.#onUpdate = onUpdate;
        this.#onFrecencyChange = onFrecencyChange;
        this.#mergeOptions = mergeOptions;
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
        const matcher = createMatcher(query);
        this.#emptyQuery = matcher.isEmpty;
        const alive = () => !cancellable.is_cancelled();

        const runs = this.#getProviders().map(provider =>
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
        const done = await this.#log.guardAsync(`activating ${item.key}`, async () => {
            await provider.activate(item.result, options);
            return true;
        }, false);
        if (done && item.result.frecencyKey) {
            this.#frecency.record(item.result.frecencyKey, this.#scheduler.now());
            this.#onFrecencyChange();
        }
        return done;
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
        return this.#log.guardAsync(`action ${action.id} on ${item.key}`, async () => {
            await provider.activateAction(item.result, action);
            return true;
        }, false);
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
        for (const result of batch) {
            if (!isUsableResult(result)) {
                this.#log.warn(`provider "${provider.id}" returned a result without id or title`);
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
        const entries = this.#getProviders().map(provider => ({
            provider,
            scored: [...(this.#scored.get(provider.id)?.values() ?? [])],
        }));
        const merged = mergeResults(entries, {...this.#mergeOptions, topHit: !this.#emptyQuery});
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
