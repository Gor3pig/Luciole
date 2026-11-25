/**
 * Ordered registry of cleanup callbacks.
 *
 * Everything the extension creates (signal connections, GLib sources, actors,
 * cancellables, ...) registers its own cleanup here right after creation.
 * dispose() runs the callbacks in reverse order of registration, so a resource
 * is always released before the ones it depends on. A callback that throws is
 * reported and never prevents the others from running.
 */
export class Disposables {
    #items = [];
    #disposed = false;
    #onError;

    /**
     * @param {(error: unknown) => void} [onError] - called for each failing callback
     */
    constructor(onError = () => {}) {
        this.#onError = onError;
    }

    get disposed() {
        return this.#disposed;
    }

    get size() {
        return this.#items.length;
    }

    /**
     * Registers a cleanup callback. If the registry is already disposed, the
     * callback runs immediately: a late registration must not leak.
     *
     * @param {() => void} fn
     * @returns {() => void} the same callback, to use with release()
     */
    add(fn) {
        if (typeof fn !== 'function')
            throw new TypeError('Disposables.add() expects a function');
        if (this.#disposed)
            this.#run(fn);
        else
            this.#items.push(fn);
        return fn;
    }

    /**
     * Runs one registered callback now and forgets it, so dispose() will not
     * run it again. Does nothing if the callback is not registered.
     *
     * @param {() => void} fn
     */
    release(fn) {
        const index = this.#items.lastIndexOf(fn);
        if (index < 0)
            return;
        this.#items.splice(index, 1);
        this.#run(fn);
    }

    /**
     * Runs every remaining callback in reverse order. Safe to call twice:
     * the list is emptied as it runs, so a second call finds nothing to do.
     */
    dispose() {
        this.#disposed = true;
        while (this.#items.length > 0)
            this.#run(this.#items.pop());
    }

    #run(fn) {
        try {
            fn();
        } catch (error) {
            try {
                this.#onError(error);
            } catch {
                // The error reporter itself failed: nothing left to do.
            }
        }
    }
}
