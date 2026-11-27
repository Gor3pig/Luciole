// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Stands in for the LocalSearch file index in the test session: an in-memory
// database with a few made-up files, published on the bus under the name
// LocalSearch uses, so the extension connects to it exactly as it would to the
// real index.
//
//   gjs -m tests/shell/index-service.js
//
// Run it inside the private test bus only: the name is owned for as long as it runs.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Tracker from 'gi://Tracker';

const FILES = [
    ['/home/tester/Documents', 'Quokka annuel.odt'],
    ['/home/tester/Documents', 'Quokka trimestriel.odt'],
    ['/home/tester/Documents', 'Facture mars.pdf'],
    ['/home/tester/Images', 'quokka-photo.png'],
    ['/home/tester/.cache', 'quokka-cache.txt'],
    ['/home/tester/projet/node_modules/lib', 'quokka.js'],
    // Folders end with "/": kept as a file whose content is an nfo:Folder, as LocalSearch does.
    ['/home/tester/Documents', 'Pinsonnet/'],
    ['/home/tester/Documents/Archives', 'Pinsonnet 2025/'],
    ['/home/tester/Documents/Pinsonnet', 'pinsonnet-mars.ods'],
    ['/home/tester/.cache', 'pinsonnet-cache/'],
];

// INDEX_DEMO=en or fr: made-up everyday files instead, for the screenshots of the README.
const DEMO = {
    en: [
        ['/home/tester/Documents', 'Project plan.odt'], ['/home/tester/Documents', 'Budget 2026.ods'],
        ['/home/tester/Documents', 'Invoice March.pdf'], ['/home/tester/Documents', 'Invoice February.pdf'],
        ['/home/tester/Documents', 'Meeting notes.md'], ['/home/tester/Pictures', 'Holiday by the sea.jpg'],
        ['/home/tester/Pictures', 'Profile picture.png'], ['/home/tester/Music', 'Morning playlist.ogg'],
        ['/home/tester/Documents', 'Invoices/'],
    ],
    fr: [
        ['/home/tester/Documents', 'Plan du projet.odt'], ['/home/tester/Documents', 'Budget 2026.ods'],
        ['/home/tester/Documents', 'Facture mars.pdf'], ['/home/tester/Documents', 'Facture février.pdf'],
        ['/home/tester/Documents', 'Notes de réunion.md'], ['/home/tester/Images', 'Vacances à la mer.jpg'],
        ['/home/tester/Images', 'Photo de profil.png'], ['/home/tester/Musique', 'Playlist du matin.ogg'],
        ['/home/tester/Documents', 'Factures/'],
    ],
};
const demo = DEMO[GLib.getenv('INDEX_DEMO') ?? ''];
if (demo)
    FILES.splice(0, FILES.length, ...demo);

// INDEX_EXTRA=<n> adds n more files, to see the list scroll.
for (let i = 1; i <= Number(GLib.getenv('INDEX_EXTRA') ?? 0); i++)
    FILES.push(['/home/tester/Archives', `quokka-archive-${String(i).padStart(2, '0')}.txt`]);

// INDEX_REAL_FILE=<path> adds a file that really exists (for the actions that need one).
const realFile = GLib.getenv('INDEX_REAL_FILE');
if (realFile)
    FILES.push([GLib.path_get_dirname(realFile), GLib.path_get_basename(realFile)]);

const database = Tracker.SparqlConnection.new(
    Tracker.SparqlConnectionFlags.NONE, null, Tracker.sparql_get_ontology_nepomuk(), null);
for (const [folder, listed] of FILES) {
    const isFolder = listed.endsWith('/');
    const name = isFolder ? listed.slice(0, -1) : listed;
    const url = `file://${folder}/${encodeURIComponent(name)}`;
    database.update(
        `INSERT DATA { <${url}> a nfo:FileDataObject ; nie:url "${url}" ; nfo:fileName "${name}" ; ` +
        'nfo:fileLastModified "2026-11-01T10:00:00Z" . }', null);
    if (isFolder) {
        database.update(
            `INSERT DATA { <${url}#content> a nfo:Folder ; nie:isStoredAs <${url}> ; nie:mimeType "inode/directory" . }`, null);
    }
}

const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
const endpoint = Tracker.EndpointDBus.new(database, bus, null, null);
Gio.bus_own_name_on_connection(bus, 'org.freedesktop.LocalSearch3', Gio.BusNameOwnerFlags.NONE, null, null);
print('index ready');

// Keep the endpoint alive for as long as the test runs.
globalThis.endpoint = endpoint;
new GLib.MainLoop(null, false).run();
