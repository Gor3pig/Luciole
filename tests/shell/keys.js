// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Long-lived helper that types keys into the test shell through Mutter's remote
// desktop interface. Mutter closes a remote desktop session as soon as the
// client that created it leaves the bus, so one process must keep it open.
//
//   gjs -m tests/shell/keys.js <command fifo> <acknowledgement fifo>
//
// Commands, one per line, answered with "ok":
//   combo            Ctrl+Alt+Space
//   escape           the Escape key
//   key <name>       Down, Up, Return, BackSpace, Escape
//   chord <a+b+c>    holds the modifiers, taps the last key (Control_L+Next)
//   code <a+b+n>     like chord, but the last key is a physical key, by its evdev code (Control_L+3 is the
//                    key that types 3 on a US keyboard and an accented letter on a French one)
//   type <text>      types the characters one by one
//   pointer <x> <y>  puts the pointer at x, y (first in the top-left corner, then moves by x, y)
//   click            presses and releases the left button where the pointer is
//   rclick           the same with the right button
//   move <dx> <dy>   moves the pointer by dx, dy from where it is
//   quit             stops the helper
// It writes "ready" once the session is started.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const [commandFifo, ackFifo] = ARGV;

const NAME = 'org.gnome.Mutter.RemoteDesktop';
const PATH = '/org/gnome/Mutter/RemoteDesktop';
const KEY_CONTROL_L = 65507;
const KEY_ALT_L = 65513;
const KEY_SPACE = 32;
const BTN_LEFT = 0x110;
const BTN_RIGHT = 0x111;
const KEY_ESCAPE = 65307;
const NAMED_KEYS = {
    Down: 65364, Up: 65362, Return: 65293, BackSpace: 65288, Escape: KEY_ESCAPE, Tab: 65289,
    ISO_Left_Tab: 65056, 0: 48, 1: 49, 2: 50, 3: 51, 4: 52, 5: 53, 6: 54, 7: 55, a: 97, c: 99, v: 118, k: 107, q: 113, w: 119, y: 121, Next: 65366, Prior: 65365, Right: 65363, Left: 65361, Control_L: KEY_CONTROL_L, Alt_L: KEY_ALT_L, Shift_L: 65505, Super_L: 65515,
};

const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);

function call(path, iface, method, params, replyType) {
    return bus.call_sync(NAME, path, iface, method, params,
        replyType ? new GLib.VariantType(replyType) : null,
        Gio.DBusCallFlags.NONE, -1, null);
}

const [sessionPath] = call(PATH, NAME, 'CreateSession', null, '(o)').deepUnpack();
const sessionIface = `${NAME}.Session`;
call(sessionPath, sessionIface, 'Start', null, null);

function key(keysym, pressed) {
    call(sessionPath, sessionIface, 'NotifyKeyboardKeysym',
        new GLib.Variant('(ub)', [keysym, pressed]), null);
}

function tap(keysym) {
    key(keysym, true);
    key(keysym, false);
}

function moveBy(dx, dy) {
    call(sessionPath, sessionIface, 'NotifyPointerMotionRelative', new GLib.Variant('(dd)', [dx, dy]), null);
}

const commands = {
    pointer(spec) {
        const [x, y] = spec.split(' ').map(Number);
        if (!Number.isFinite(x) || !Number.isFinite(y))
            throw new Error(`bad position: ${spec}`);
        // The corner is a known position (the pointer stops at the screen edge).
        moveBy(-5000, 0);
        moveBy(0, -5000);
        moveBy(x, 0);
        moveBy(0, y);
    },
    click() {
        for (const pressed of [true, false])
            call(sessionPath, sessionIface, 'NotifyPointerButton', new GLib.Variant('(ib)', [BTN_LEFT, pressed]), null);
    },
    rclick() {
        for (const pressed of [true, false])
            call(sessionPath, sessionIface, 'NotifyPointerButton', new GLib.Variant('(ib)', [BTN_RIGHT, pressed]), null);
    },
    // Moves the pointer by dx, dy from where it is (without passing through a screen corner).
    move(spec) {
        const [dx, dy] = spec.split(' ').map(Number);
        if (!Number.isFinite(dx) || !Number.isFinite(dy))
            throw new Error(`bad move: ${spec}`);
        moveBy(dx, dy);
    },
    combo() {
        key(KEY_CONTROL_L, true);
        key(KEY_ALT_L, true);
        tap(KEY_SPACE);
        key(KEY_ALT_L, false);
        key(KEY_CONTROL_L, false);
    },
    escape() {
        tap(KEY_ESCAPE);
    },
    key(name) {
        if (!(name in NAMED_KEYS))
            throw new Error(`unknown key ${name}`);
        tap(NAMED_KEYS[name]);
    },
    chord(spec) {
        const names = spec.split('+');
        const last = names.pop();
        for (const name of [...names, last]) {
            if (!(name in NAMED_KEYS))
                throw new Error(`unknown key ${name}`);
        }
        for (const name of names)
            key(NAMED_KEYS[name], true);
        tap(NAMED_KEYS[last]);
        for (const name of names.reverse())
            key(NAMED_KEYS[name], false);
    },
    code(spec) {
        const names = spec.split('+');
        const evdev = Number(names.pop());
        if (!Number.isInteger(evdev))
            throw new Error(`bad key code in ${spec}`);
        for (const name of names) {
            if (!(name in NAMED_KEYS))
                throw new Error(`unknown key ${name}`);
        }
        for (const name of names)
            key(NAMED_KEYS[name], true);
        for (const pressed of [true, false])
            call(sessionPath, sessionIface, 'NotifyKeyboardKeycode', new GLib.Variant('(ub)', [evdev, pressed]), null);
        for (const name of names.reverse())
            key(NAMED_KEYS[name], false);
    },
    type(text) {
        for (const character of text) {
            const code = character.codePointAt(0);
            // Latin-1 characters have the same keysym as their code point; others use the Unicode range.
            tap(code < 0x100 ? code : 0x01000000 + code);
        }
    },
};

function readLine(path) {
    const stream = new Gio.DataInputStream({
        base_stream: Gio.File.new_for_path(path).read(null),
    });
    const [line] = stream.read_line_utf8(null);
    stream.close(null);
    return line;
}

function writeLine(path, text) {
    // append_to() only opens the fifo for writing; replace() would swap the fifo for a regular file.
    const stream = Gio.File.new_for_path(path).append_to(Gio.FileCreateFlags.NONE, null);
    stream.write_all(`${text}\n`, null);
    stream.close(null);
}

writeLine(ackFifo, 'ready');

for (;;) {
    const command = readLine(commandFifo);
    if (command === 'quit' || command === null)
        break;
    try {
        const space = command.indexOf(' ');
        const name = space < 0 ? command : command.slice(0, space);
        commands[name](space < 0 ? '' : command.slice(space + 1));
        writeLine(ackFifo, 'ok');
    } catch (error) {
        writeLine(ackFifo, `error: ${error.message}`);
    }
}
