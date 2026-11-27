// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Stands in for the desktop's file manager in the test session: owns the standard
// org.freedesktop.FileManager1 name on the private test bus and writes each address it is asked to
// show to the file given as its argument, one per line. Nothing is opened.
//
//   gjs -m tests/shell/filemanager-service.js <file for the addresses>

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const [record] = ARGV;
const XML = `<node><interface name="org.freedesktop.FileManager1">
  <method name="ShowFolders"><arg type="as" direction="in"/><arg type="s" direction="in"/></method>
  <method name="ShowItems"><arg type="as" direction="in"/><arg type="s" direction="in"/></method>
  <method name="ShowItemProperties"><arg type="as" direction="in"/><arg type="s" direction="in"/></method>
</interface></node>`;

function note(method, uris) {
    const file = Gio.File.new_for_path(record);
    const stream = file.append_to(Gio.FileCreateFlags.NONE, null);
    stream.write_all(new TextEncoder().encode(uris.map(uri => `${method} ${uri}\n`).join('')), null);
    stream.close(null);
}

const service = {
    ShowFolders: uris => note('ShowFolders', uris),
    ShowItems: uris => note('ShowItems', uris),
    ShowItemProperties: uris => note('ShowItemProperties', uris),
};
const exported = Gio.DBusExportedObject.wrapJSObject(XML, service);
const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
exported.export(bus, '/org/freedesktop/FileManager1');
Gio.bus_own_name_on_connection(bus, 'org.freedesktop.FileManager1', Gio.BusNameOwnerFlags.NONE,
    () => print('file manager ready'), () => print('file manager name lost'));
new GLib.MainLoop(null, false).run();
