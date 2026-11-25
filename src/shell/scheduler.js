import GLib from 'gi://GLib';

/**
 * The scheduler the search controller uses in the shell (the tests use a fake
 * one). Every pending timer is tracked, so destroy() leaves nothing behind.
 */
export class GLibScheduler {
    #sources = new Set();

    now() {
        return Date.now();
    }

    /** Resolves after `ms`, or as soon as the cancellable is cancelled. */
    sleep(ms, cancellable) {
        return new Promise(resolve => {
            let link = 0;
            const id = this.#after(ms, () => {
                if (link)
                    cancellable.disconnect(link);
                resolve();
            });
            if (cancellable) {
                // Gio.Cancellable.connect() takes the callback only.
                link = cancellable.connect(() => {
                    this.#remove(id);
                    resolve();
                });
            }
        });
    }

    /** @returns {{promise: Promise<void>, cancel: () => void}} */
    timeout(ms) {
        let resolve;
        const promise = new Promise(r => {
            resolve = r;
        });
        const id = this.#after(ms, resolve);
        return {promise, cancel: () => this.#remove(id)};
    }

    /** Runs fn soon, once the current work is done. Returns a function that cancels it. */
    nextFrame(fn) {
        const id = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this.#sources.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this.#sources.add(id);
        return () => this.#remove(id);
    }

    destroy() {
        for (const id of this.#sources)
            GLib.Source.remove(id);
        this.#sources.clear();
    }

    #after(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this.#sources.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this.#sources.add(id);
        return id;
    }

    #remove(id) {
        if (this.#sources.delete(id))
            GLib.Source.remove(id);
    }
}
