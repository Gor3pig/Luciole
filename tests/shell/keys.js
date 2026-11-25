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
//   type <text>      types the characters one by one
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
const KEY_ESCAPE = 65307;
const NAMED_KEYS = {Down: 65364, Up: 65362, Return: 65293, BackSpace: 65288, Escape: KEY_ESCAPE};

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

const commands = {
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
