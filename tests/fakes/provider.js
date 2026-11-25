import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function cancelledError() {
    return new GLib.Error(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED, 'Operation was cancelled');
}

/** A log that remembers what it was told, for assertions. */
export function recordingLog() {
    const lines = [];
    const record = level => (message, error) => lines.push(`${level}: ${message}${error ? ` (${error.message})` : ''}`);
    return {
        lines,
        debug() {},
        info: record('info'),
        warn: record('warn'),
        error: record('error'),
        guard(label, fn, fallback) {
            try {
                return fn();
            } catch (error) {
                lines.push(`error: ${label} (${error.message})`);
                return fallback;
            }
        },
        async guardAsync(label, fn, fallback) {
            try {
                return await fn();
            } catch (error) {
                lines.push(`error: ${label} (${error.message})`);
                return fallback;
            }
        },
    };
}

/**
 * A provider with a configurable delay and outcome.
 *
 * @param {import('./scheduler.js').FakeScheduler} scheduler
 */
export function fakeProvider(scheduler, {
    id,
    priority = 100,
    scoreWeight = 1,
    latency = 0,
    results = [],
    error = null,
    debounceMs = 0,
    timeoutMs = 500,
    maxResults = 8,
    recents = [],
}) {
    const provider = {
        id,
        name: id,
        priority,
        scoreWeight,
        debounceMs,
        timeoutMs,
        maxResults,
        searches: [],
        cancellables: [],
        activated: [],
        actions: [],
        destroyed: 0,
        async init() {},
        destroy() {
            provider.destroyed++;
        },
        async search(query, {cancellable}) {
            provider.searches.push(query);
            provider.cancellables.push(cancellable);
            if (latency > 0)
                await scheduler.sleep(latency, cancellable);
            if (cancellable.is_cancelled())
                throw cancelledError();
            if (error)
                throw error;
            return typeof results === 'function' ? results(query) : results;
        },
        async emptyQueryResults() {
            return recents;
        },
        async activate(result) {
            provider.activated.push(result.id);
        },
        secondaryActions: () => [],
        async activateAction(result, action) {
            provider.actions.push(`${action.id}:${result.id}`);
        },
    };
    return provider;
}

export const result = (id, title, extra = {}) => ({id, title, ...extra});
