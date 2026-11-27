// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Stands in for the desktop portal in the test session: owns org.freedesktop.portal.Desktop on the
// private test bus and, for each file it is asked to open, writes down which file the handle it
// received points to and whether the user was to be asked, one line each. No window is shown and
// nothing is opened.
//
//   gjs -m tests/shell/portal-service.js <file for the requests>

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const [record] = ARGV;
const XML = `<node><interface name="org.freedesktop.portal.OpenURI">
  <method name="OpenFile">
    <arg type="s" name="parent_window" direction="in"/>
    <arg type="h" name="fd" direction="in"/>
    <arg type="a{sv}" name="options" direction="in"/>
    <arg type="o" name="handle" direction="out"/>
  </method>
  <property name="version" type="u" access="read"/>
</interface></node>`;

function note(line) {
    const stream = Gio.File.new_for_path(record).append_to(Gio.FileCreateFlags.NONE, null);
    stream.write_all(new TextEncoder().encode(`${line}\n`), null);
    stream.close(null);
}

let requests = 0;
const service = {
    version: 4,
    OpenFileAsync([, handle, options], invocation) {
        const fds = invocation.get_message().get_unix_fd_list();
        const fd = fds ? fds.get(handle) : -1;
        const path = fd >= 0 ? GLib.file_read_link(`/proc/self/fd/${fd}`) : 'no-handle';
        if (fd >= 0)
            GLib.close(fd);
        note(`OpenFile ${path} ask=${options.ask?.deepUnpack() === true}`);
        invocation.return_value(new GLib.Variant('(o)', [`/org/freedesktop/portal/desktop/request/test/r${++requests}`]));
    },
};
const exported = Gio.DBusExportedObject.wrapJSObject(XML, service);
const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
exported.export(bus, '/org/freedesktop/portal/desktop');
Gio.bus_own_name_on_connection(bus, 'org.freedesktop.portal.Desktop', Gio.BusNameOwnerFlags.NONE,
    () => print('portal ready'), () => print('portal name lost'));
new GLib.MainLoop(null, false).run();
