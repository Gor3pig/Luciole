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
    ['/home/tester/Documents', 'Rapport annuel.odt'],
    ['/home/tester/Documents', 'Rapport trimestriel.odt'],
    ['/home/tester/Documents', 'Facture mars.pdf'],
    ['/home/tester/Images', 'rapport-photo.png'],
    ['/home/tester/.cache', 'rapport-cache.txt'],
    ['/home/tester/projet/node_modules/lib', 'rapport.js'],
];

const database = Tracker.SparqlConnection.new(
    Tracker.SparqlConnectionFlags.NONE, null, Tracker.sparql_get_ontology_nepomuk(), null);
for (const [folder, name] of FILES) {
    const url = `file://${folder}/${encodeURIComponent(name)}`;
    database.update(
        `INSERT DATA { <${url}> a nfo:FileDataObject ; nie:url "${url}" ; nfo:fileName "${name}" ; ` +
        'nfo:fileLastModified "2026-11-01T10:00:00Z" . }', null);
}

const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
const endpoint = Tracker.EndpointDBus.new(database, bus, null, null);
Gio.bus_own_name_on_connection(bus, 'org.freedesktop.LocalSearch3', Gio.BusNameOwnerFlags.NONE, null, null);
print('index ready');

// Keep the endpoint alive for as long as the test runs.
globalThis.endpoint = endpoint;
new GLib.MainLoop(null, false).run();
