// A scheduler whose clock only moves when the test says so.

async function flushMicrotasks() {
    for (let i = 0; i < 25; i++)
        await Promise.resolve();
}

export class FakeScheduler {
    #now = 1_700_000_000_000;
    #timers = [];
    #frames = [];

    now() {
        return this.#now;
    }

    sleep(ms, cancellable) {
        return new Promise(resolve => {
            const timer = this.#add(ms, resolve);
            // Gio.Cancellable.connect() takes the callback only.
            cancellable?.connect(() => {
                this.#remove(timer);
                resolve();
            });
        });
    }

    timeout(ms) {
        let resolve;
        const promise = new Promise(r => {
            resolve = r;
        });
        const timer = this.#add(ms, resolve);
        return {promise, cancel: () => this.#remove(timer)};
    }

    nextFrame(fn) {
        this.#frames.push(fn);
        return () => {
            this.#frames = this.#frames.filter(f => f !== fn);
        };
    }

    get pendingTimers() {
        return this.#timers.length;
    }

    /** Lets promises settle and runs the frame callbacks that are waiting. */
    async tick() {
        await flushMicrotasks();
        const frames = this.#frames;
        this.#frames = [];
        for (const frame of frames)
            frame();
        await flushMicrotasks();
    }

    /** Moves the clock forward, firing the timers that become due, in order. */
    async advance(ms) {
        const target = this.#now + ms;
        await flushMicrotasks();
        for (;;) {
            const due = this.#timers
                .filter(timer => timer.at <= target)
                .sort((a, b) => a.at - b.at)[0];
            if (!due)
                break;
            this.#remove(due);
            this.#now = Math.max(this.#now, due.at);
            due.fn();
            await flushMicrotasks();
        }
        this.#now = target;
        await this.tick();
    }

    #add(ms, fn) {
        const timer = {at: this.#now + ms, fn};
        this.#timers.push(timer);
        return timer;
    }

    #remove(timer) {
        this.#timers = this.#timers.filter(t => t !== timer);
    }
}
