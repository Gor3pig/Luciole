// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _, pgettext} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// The icon shipped next to the code (see `make icon`).
const ICON_FILE = 'luciole-128x128.png';

// Schemas whose shortcuts could collide with ours.
const SHORTCUT_SCHEMAS = [
    'org.gnome.desktop.wm.keybindings',
    'org.gnome.shell.keybindings',
    'org.gnome.settings-daemon.plugins.media-keys',
    'org.gnome.mutter.keybindings',
];

const PROVIDERS = [
    {id: 'apps', title: () => _('Applications')},
    {id: 'files', title: () => _('Files')},
    {id: 'folders', title: () => _('Folders')},
    {id: 'calc', title: () => _('Calculator')},
    {id: 'system', title: () => _('System')},
];

/** Which GNOME shortcut already uses this accelerator, if any ("schema key"). */
function findShortcutConflict(accelerator) {
    const [ok, keyval, mods] = Gtk.accelerator_parse(accelerator);
    if (!ok)
        return null;
    const source = Gio.SettingsSchemaSource.get_default();
    for (const schemaId of SHORTCUT_SCHEMAS) {
        const schema = source.lookup(schemaId, true);
        if (!schema)
            continue;
        const settings = new Gio.Settings({settings_schema: schema});
        for (const key of schema.list_keys()) {
            if (schema.get_key(key).get_value_type().dup_string() !== 'as')
                continue;
            for (const other of settings.get_strv(key)) {
                const [otherOk, otherKey, otherMods] = Gtk.accelerator_parse(other);
                if (otherOk && otherKey === keyval && otherMods === mods)
                    return key;
            }
        }
    }
    return null;
}

/** A shortcut must include a modifier (or be a function key), or it would break typing. */
function isUsableShortcut(keyval, mods) {
    const isFunctionKey = keyval >= Gdk.KEY_F1 && keyval <= Gdk.KEY_F12;
    return mods !== 0 || isFunctionKey;
}

export default class LucioleExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        // Keep the settings object alive as long as the window.
        window._settings = settings;
        window.set_default_size(640, 720);
        window.add(this._generalPage(window, settings));
        window.add(this._appearancePage(settings));
        window.add(this._searchPage(window, settings));
    }

    // The icon, the name and one line, centred above the settings. Without the icon file (a local
    // run that did not copy it) the name and the line are shown alone.
    _headerGroup() {
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, halign: Gtk.Align.CENTER, margin_top: 6, margin_bottom: 6});
        const file = Gio.File.new_for_path(GLib.build_filenamev([this.path, ICON_FILE]));
        if (file.query_exists(null)) {
            const picture = Gtk.Picture.new_for_file(file);
            picture.set_can_shrink(true);
            picture.set_content_fit(Gtk.ContentFit.CONTAIN);
            picture.set_size_request(96, 96);
            picture.set_halign(Gtk.Align.CENTER);
            picture.set_accessible_role?.(Gtk.AccessibleRole.IMG);
            picture.set_alternative_text(_('Luciole icon: a firefly glowing in a jar'));
            box.append(picture);
        }
        box.append(new Gtk.Label({label: 'Luciole', css_classes: ['title-1']}));
        box.append(new Gtk.Label({label: _('A search launcher for GNOME'), css_classes: ['dim-label']}));
        const group = new Adw.PreferencesGroup();
        group.add(box);
        return group;
    }

    _backdropRow(settings) {
        const levels = ['none', 'light', 'standard'];
        const row = new Adw.ComboRow({
            title: _('Backdrop'),
            subtitle: _('Dims the rest of the screen while Luciole is open'),
            model: Gtk.StringList.new([_('None'), _('Light'), _('Standard')]),
        });
        row.selected = Math.max(0, levels.indexOf(settings.get_string('backdrop')));
        row.connect('notify::selected', () => {
            settings.set_string('backdrop', levels[row.selected] ?? 'none');
        });
        return row;
    }

    _openClickRow(settings) {
        const modes = ['single', 'double'];
        const row = new Adw.ComboRow({
            title: _('Open a Result'),
            subtitle: _('With the mouse. Enter always opens the chosen result'),
            model: Gtk.StringList.new([_('With a Single Click'), _('With a Double Click')]),
        });
        row.selected = Math.max(0, modes.indexOf(settings.get_string('open-click')));
        row.connect('notify::selected', () => {
            settings.set_string('open-click', modes[row.selected] ?? 'single');
        });
        return row;
    }

    _animationsRow(settings) {
        const row = new Adw.SwitchRow({
            title: _('Animations'),
            subtitle: _('Opening, closing and the list growing. No effect when animations are off in GNOME'),
        });
        settings.bind('animations', row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    // How Luciole is opened and how it behaves.
    _generalPage(window, settings) {
        const page = new Adw.PreferencesPage({title: _('General'), icon_name: 'preferences-system-symbolic'});

        page.add(this._headerGroup());

        const shortcutGroup = new Adw.PreferencesGroup({title: _('Shortcut')});
        shortcutGroup.add(this._shortcutRow(window, settings));
        page.add(shortcutGroup);

        const behaviorGroup = new Adw.PreferencesGroup({title: _('Behavior')});
        behaviorGroup.add(this._openClickRow(settings));
        const maxResults = new Adw.SpinRow({
            title: _('Results per Source'),
            subtitle: _('How many results each source shows at most'),
            adjustment: new Gtk.Adjustment({lower: 3, upper: 30, step_increment: 1, page_increment: 5}),
        });
        settings.bind('max-results', maxResults, 'value', Gio.SettingsBindFlags.DEFAULT);
        behaviorGroup.add(maxResults);
        page.add(behaviorGroup);

        const advanced = new Adw.PreferencesGroup({title: _('Advanced')});
        const debug = new Adw.SwitchRow({
            title: _('Log Timings'),
            subtitle: _('Writes debug messages to the system journal'),
        });
        settings.bind('debug-timings', debug, 'active', Gio.SettingsBindFlags.DEFAULT);
        advanced.add(debug);
        page.add(advanced);
        return page;
    }

    // How the window looks.
    _appearancePage(settings) {
        const page = new Adw.PreferencesPage({title: _('Appearance'), icon_name: 'preferences-desktop-appearance-symbolic'});
        const windowGroup = new Adw.PreferencesGroup({title: _('Window')});
        windowGroup.add(this._backdropRow(settings));
        windowGroup.add(this._animationsRow(settings));
        page.add(windowGroup);
        return page;
    }

    _historyGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('History'),
            description: _('Luciole remembers which results you open and the searches that led to them, only on this computer.'),
        });
        const remember = new Adw.SwitchRow({
            title: _('Remember Searches'),
            subtitle: _('Lets the up arrow bring back a previous search. Turning this off erases them'),
        });
        settings.bind('remember-queries', remember, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(remember);
        const clear = new Adw.ButtonRow({title: _('Clear History'), css_classes: ['destructive-action']});
        clear.connect('activated', () => {
            settings.set_int('history-generation', settings.get_int('history-generation') + 1);
        });
        group.add(clear);
        return group;
    }

    _shortcutRow(window, settings) {
        const row = new Adw.ActionRow({title: _('Open Luciole')});
        const label = new Gtk.ShortcutLabel({
            valign: Gtk.Align.CENTER,
            disabled_text: _('Disabled'),
        });
        const refresh = () => {
            const [accelerator] = settings.get_strv('toggle-shortcut');
            label.accelerator = accelerator ?? '';
            const conflict = accelerator ? findShortcutConflict(accelerator) : null;
            // Translators: %s is the name of another GNOME shortcut
            row.subtitle = conflict === null ? '' : _('Already used by the GNOME shortcut “%s”').format(conflict);
        };
        const change = new Gtk.Button({label: _('Change…'), valign: Gtk.Align.CENTER});
        change.connect('clicked', () => this._captureShortcut(window, settings));
        row.add_suffix(label);
        row.add_suffix(change);
        settings.connect('changed::toggle-shortcut', refresh);
        refresh();
        return row;
    }

    _captureShortcut(window, settings) {
        const dialog = new Adw.AlertDialog({
            heading: _('Set Shortcut'),
            body: _('Press the new shortcut. Escape cancels, Backspace disables the shortcut.'),
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.set_close_response('cancel');

        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_controller, keyval, _keycode, state) => {
            const mods = state & Gtk.accelerator_get_default_mod_mask();
            if (keyval === Gdk.KEY_Escape && mods === 0) {
                dialog.close();
            } else if (keyval === Gdk.KEY_BackSpace && mods === 0) {
                settings.set_strv('toggle-shortcut', []);
                dialog.close();
            } else if (isUsableShortcut(keyval, mods) && !this._isModifierKey(keyval)) {
                settings.set_strv('toggle-shortcut', [Gtk.accelerator_name(keyval, mods)]);
                dialog.close();
            }
            return Gdk.EVENT_STOP;
        });
        dialog.add_controller(keys);
        dialog.present(window);
    }

    _isModifierKey(keyval) {
        return [
            Gdk.KEY_Shift_L, Gdk.KEY_Shift_R, Gdk.KEY_Control_L, Gdk.KEY_Control_R,
            Gdk.KEY_Alt_L, Gdk.KEY_Alt_R, Gdk.KEY_Super_L, Gdk.KEY_Super_R,
            Gdk.KEY_Meta_L, Gdk.KEY_Meta_R, Gdk.KEY_ISO_Level3_Shift,
        ].includes(keyval);
    }

    // What Luciole searches, what it leaves out, and what it remembers.
    _searchPage(window, settings) {
        // Translators: the name of the preferences page about searching (a noun)
        const page = new Adw.PreferencesPage({title: pgettext('preferences page', 'Search'), icon_name: 'system-search-symbolic'});

        const providers = new Adw.PreferencesGroup({
            title: _('Sources'),
            description: _('What Luciole searches.'),
        });
        for (const provider of PROVIDERS) {
            const row = new Adw.SwitchRow({title: provider.title()});
            const sync = () => {
                row.active = settings.get_strv('providers-enabled').includes(provider.id);
            };
            sync();
            row.connect('notify::active', () => {
                const enabled = settings.get_strv('providers-enabled').filter(id => id !== provider.id);
                if (row.active)
                    enabled.push(provider.id);
                // Keep the order the sources are declared in.
                const ordered = PROVIDERS.map(p => p.id).filter(id => enabled.includes(id));
                if (ordered.join() !== settings.get_strv('providers-enabled').join())
                    settings.set_strv('providers-enabled', ordered);
            });
            settings.connect('changed::providers-enabled', sync);
            providers.add(row);
        }
        page.add(providers);

        page.add(this._listGroup(window, settings, 'excluded-folders', {
            title: _('Excluded Folders'),
            description: _('Files in these folders are never shown. A name such as “node_modules” excludes every folder with that name; hidden files are always left out.'),
            addLabel: _('Add Folder…'),
            pick: callback => this._pickFolder(window, callback),
        }));
        page.add(this._listGroup(window, settings, 'excluded-types', {
            title: _('Excluded File Types'),
            description: _('Files with these extensions are never shown, for example “tmp” or “.log”.'),
            addLabel: _('Add Type'),
            entry: true,
        }));
        page.add(this._historyGroup(settings));
        return page;
    }

    // A list of strings kept in a setting, with a remove button on each and a way to add one.
    _listGroup(window, settings, key, {title, description, addLabel, pick, entry}) {
        const group = new Adw.PreferencesGroup({title, description});
        const rows = [];
        const rebuild = () => {
            for (const row of rows.splice(0))
                group.remove(row);
            for (const value of settings.get_strv(key)) {
                const row = new Adw.ActionRow({title: GLib.markup_escape_text(value, -1)});
                const remove = new Gtk.Button({
                    icon_name: 'edit-delete-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat'],
                    tooltip_text: _('Remove'),
                });
                remove.connect('clicked', () => {
                    settings.set_strv(key, settings.get_strv(key).filter(v => v !== value));
                });
                row.add_suffix(remove);
                group.add(row);
                rows.push(row);
            }
        };
        const add = value => {
            const clean = value.trim();
            const current = settings.get_strv(key);
            if (clean !== '' && !current.includes(clean))
                settings.set_strv(key, [...current, clean]);
        };

        if (entry) {
            const input = new Adw.EntryRow({title: addLabel, show_apply_button: true});
            input.connect('apply', () => {
                add(input.text);
                input.text = '';
            });
            group.add(input);
        } else {
            const button = new Adw.ButtonRow({title: addLabel});
            button.connect('activated', () => pick(add));
            group.add(button);
        }
        settings.connect(`changed::${key}`, rebuild);
        rebuild();
        return group;
    }

    _pickFolder(window, callback) {
        const dialog = new Gtk.FileDialog({title: _('Choose a Folder to Exclude')});
        dialog.select_folder(window, null, (source, result) => {
            try {
                const folder = source.select_folder_finish(result);
                const home = GLib.get_home_dir();
                const path = folder.get_path();
                callback(path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path);
            } catch {
                // The user closed the dialog without choosing: nothing to do.
            }
        });
    }
}
