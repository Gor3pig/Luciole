import {createLogger} from '../src/core/log.js';
import {assert, assertEquals, test} from './harness.js';

function fakeSink() {
    const lines = [];
    const record = level => message => lines.push(`${level}:${message}`);
    return {
        lines,
        debug: record('debug'),
        log: record('log'),
        warn: record('warn'),
        error: record('error'),
    };
}

test('debug messages are silent unless debug is enabled', () => {
    const sink = fakeSink();
    let debug = false;
    const log = createLogger({sink, isDebug: () => debug});
    log.debug('hidden');
    debug = true;
    log.debug('shown');
    assertEquals(sink.lines, ['debug:[Luciole] shown']);
});

test('a throwing isDebug counts as disabled', () => {
    const sink = fakeSink();
    const log = createLogger({
        sink,
        isDebug: () => {
            throw new Error('settings gone');
        },
    });
    log.debug('hidden');
    assertEquals(sink.lines, []);
});

test('warn and error carry the prefix; error appends the cause', () => {
    const sink = fakeSink();
    const log = createLogger({sink});
    log.warn('careful');
    log.error('failed', new Error('why'));
    assertEquals(sink.lines[0], 'warn:[Luciole] careful');
    assert(sink.lines[1].startsWith('error:[Luciole] failed: why'), sink.lines[1]);
});

test('guard returns the result when nothing throws', () => {
    const log = createLogger({sink: fakeSink()});
    assertEquals(log.guard('ok', () => 42, -1), 42);
});

test('guard swallows an error, logs it once and returns the fallback', () => {
    const sink = fakeSink();
    const log = createLogger({sink});
    const result = log.guard('provider apps', () => {
        throw new Error('kaput');
    }, 'fallback');
    assertEquals(result, 'fallback');
    assertEquals(sink.lines.length, 1);
    assert(sink.lines[0].includes('provider apps: kaput'), sink.lines[0]);
});

test('guardAsync swallows a rejection and returns the fallback', async () => {
    const sink = fakeSink();
    const log = createLogger({sink});
    const result = await log.guardAsync('files', async () => {
        throw new Error('timeout');
    }, []);
    assertEquals(result, []);
    assertEquals(sink.lines.length, 1);
});

test('guardAsync returns the resolved value', async () => {
    const log = createLogger({sink: fakeSink()});
    assertEquals(await log.guardAsync('ok', async () => 'done', null), 'done');
});
