// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Takes one PNG screenshot of the test shell's virtual monitor.
//
//   gjs -m tests/shell/capture.js <output.png> [connector]
//
// The shell's own screenshot interface refuses unknown clients, so this uses
// Mutter's ScreenCast interface (the one desktop portals use): it opens a
// PipeWire stream of the monitor and gst-launch saves a single frame of it. The
// D-Bus client must stay alive while the frame is saved, hence one process.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const [output, connector = 'Meta-0'] = ARGV;
if (!output) {
    printerr('usage: capture.js <output.png> [connector]');
    imports.system.exit(2);
}

const NAME = 'org.gnome.Mutter.ScreenCast';
const TIMEOUT_SECONDS = 20;

const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
const loop = new GLib.MainLoop(null, false);
let exitCode = 1;

function call(path, iface, method, params, replyType) {
    return bus.call_sync(NAME, path, iface, method, params,
        new GLib.VariantType(replyType), Gio.DBusCallFlags.NONE, -1, null);
}

const [sessionPath] = call('/org/gnome/Mutter/ScreenCast', NAME, 'CreateSession',
    new GLib.Variant('(a{sv})', [{}]), '(o)').deepUnpack();
const sessionIface = `${NAME}.Session`;
const [streamPath] = call(sessionPath, sessionIface, 'RecordMonitor',
    new GLib.Variant('(sa{sv})', [connector, {}]), '(o)').deepUnpack();

const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, TIMEOUT_SECONDS, () => {
    printerr('capture: timed out');
    loop.quit();
    return GLib.SOURCE_REMOVE;
});

function saveFrame(nodeId) {
    const gst = Gio.Subprocess.new([
        'gst-launch-1.0', '-q',
        'pipewiresrc', `path=${nodeId}`, 'num-buffers=1',
        '!', 'videoconvert', '!', 'pngenc', '!', 'filesink', `location=${output}`,
    ], Gio.SubprocessFlags.NONE);
    gst.wait_check_async(null, (_proc, result) => {
        try {
            gst.wait_check_finish(result);
            exitCode = 0;
        } catch (error) {
            printerr(`capture: gst-launch failed: ${error.message}`);
        }
        loop.quit();
    });
}

bus.signal_subscribe(NAME, `${NAME}.Stream`, 'PipeWireStreamAdded', streamPath, null,
    Gio.DBusSignalFlags.NONE, (_conn, _sender, _path, _iface, _signal, parameters) => {
        const [nodeId] = parameters.deepUnpack();
        saveFrame(nodeId);
    });

call(sessionPath, sessionIface, 'Start', null, '()');
loop.run();

GLib.source_remove(timeoutId);
try {
    call(sessionPath, sessionIface, 'Stop', null, '()');
} catch {
    // The session may already be gone; nothing to clean up then.
}
imports.system.exit(exitCode);
