// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

const PREFIX = '[Luciole]';

function describe(error) {
    if (error instanceof Error)
        return error.stack ? `${error.message}\n${error.stack}` : error.message;
    return String(error);
}

/**
 * Creates the extension logger.
 *
 * debug() messages are only written when isDebug() returns true. guard() and
 * guardAsync() are the error barriers: whatever the wrapped code throws is
 * logged and swallowed, and the caller gets the fallback value instead.
 *
 * @param {object} [options]
 * @param {Pick<Console, 'debug' | 'log' | 'warn' | 'error'>} [options.sink]
 * @param {() => boolean} [options.isDebug]
 */
export function createLogger({sink = console, isDebug = () => false} = {}) {
    const debugEnabled = () => {
        try {
            return isDebug() === true;
        } catch {
            return false;
        }
    };

    const logger = {
        debug(message) {
            if (debugEnabled())
                sink.debug(`${PREFIX} ${message}`);
        },

        info(message) {
            sink.log(`${PREFIX} ${message}`);
        },

        warn(message) {
            sink.warn(`${PREFIX} ${message}`);
        },

        error(message, error) {
            const detail = error === undefined ? '' : `: ${describe(error)}`;
            sink.error(`${PREFIX} ${message}${detail}`);
        },

        guard(label, fn, fallback) {
            try {
                return fn();
            } catch (error) {
                logger.error(label, error);
                return fallback;
            }
        },

        async guardAsync(label, fn, fallback) {
            try {
                return await fn();
            } catch (error) {
                logger.error(label, error);
                return fallback;
            }
        },
    };

    return logger;
}
