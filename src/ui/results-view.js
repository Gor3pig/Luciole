import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {splitByRanges} from '../core/text.js';

const FALLBACK_ICON = 'application-x-executable-symbolic';

/**
 * The list of results: a "top hit" heading, then one section per provider.
 * It only assigns style classes; colours and sizes live in the stylesheets.
 * Rows are rebuilt on every update, which is cheap for the handful shown.
 */
export class ResultsView {
    #actor;
    #gettext;
    #onActivate;
    #rows = new Map();

    constructor({gettext, onActivate}) {
        this.#gettext = gettext;
        this.#onActivate = onActivate;
        this.#actor = new St.BoxLayout({
            style_class: 'luciole-results',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
    }

    get actor() {
        return this.#actor;
    }

    /**
     * @param {{topHit: object | null, sections: Array<{title: string, items: object[]}>}} merged
     * @param {string | null} selectedKey
     */
    update(merged, selectedKey) {
        this.clear();
        if (merged.topHit) {
            this.#addHeading(this.#gettext('Top Hit'));
            this.#addRow(merged.topHit);
        }
        for (const section of merged.sections) {
            this.#addHeading(section.title);
            for (const item of section.items)
                this.#addRow(item);
        }
        this.select(selectedKey);
    }

    select(key) {
        for (const [rowKey, row] of this.#rows) {
            if (rowKey === key)
                row.add_style_pseudo_class('selected');
            else
                row.remove_style_pseudo_class('selected');
        }
    }

    clear() {
        this.#rows.clear();
        this.#actor.destroy_all_children();
    }

    #addHeading(text) {
        this.#actor.add_child(new St.Label({style_class: 'luciole-section-title', text}));
    }

    #addRow(item) {
        const {result} = item;

        const title = new St.BoxLayout({style_class: 'luciole-row-title'});
        for (const part of splitByRanges(result.title, item.ranges)) {
            title.add_child(new St.Label({
                text: part.text,
                style_class: part.match ? 'luciole-row-match' : 'luciole-row-text',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }

        const text = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        text.add_child(title);
        if (result.subtitle) {
            text.add_child(new St.Label({
                text: result.subtitle,
                style_class: 'luciole-row-subtitle',
            }));
        }

        const content = new St.BoxLayout({x_expand: true});
        content.add_child(new St.Icon({
            style_class: 'luciole-row-icon',
            ...(result.icon instanceof Gio.Icon
                ? {gicon: result.icon}
                : {icon_name: typeof result.icon === 'string' ? result.icon : FALLBACK_ICON}),
        }));
        content.add_child(text);

        const row = new St.Button({
            style_class: 'luciole-row',
            can_focus: false,
            x_expand: true,
            child: content,
        });
        row.connect('clicked', () => this.#onActivate(item));

        this.#rows.set(item.key, row);
        this.#actor.add_child(row);
    }
}
