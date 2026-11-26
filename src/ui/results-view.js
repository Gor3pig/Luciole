// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {needsHeightEase} from '../core/layout.js';
import {splitByRanges} from '../core/text.js';
import * as compat from '../shell/compat.js';
import {describeList, describeResult, setSelected} from './a11y.js';

const HEIGHT_MS = 120;
const FALLBACK_ICON = 'application-x-executable-symbolic';

/**
 * The list of results: a "top hit" heading, then one section per provider.
 * It only assigns style classes; colours and sizes live in the stylesheets.
 * Rows are rebuilt on every update, which is cheap for the handful shown.
 */
export class ResultsView {
    #actor;
    #box;
    #gettext;
    #onActivate;
    #rows = new Map();

    constructor({gettext, onActivate}) {
        this.#gettext = gettext;
        this.#onActivate = onActivate;
        this.#box = new St.BoxLayout({
            style_class: 'luciole-results',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        // The list scrolls when it is taller than the room the window leaves it.
        this.#actor = new St.ScrollView({
            style_class: 'luciole-results-view',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            child: this.#box,
        });
        describeList(this.#box, gettext('Results'));
    }

    /** Limits the height of the list, in logical pixels; beyond it, it scrolls. */
    setMaxHeight(pixels) {
        this.#actor.set_style(`max-height: ${pixels}px;`);
    }

    get actor() {
        return this.#actor;
    }

    /**
     * @param {{topHit: object | null, sections: Array<{title: string, items: object[]}>}} merged
     * @param {string | null} selectedKey
     */
    update(merged, selectedKey, animate = false) {
        // The height on screen right now (mid-animation included), before the rows change.
        const from = this.#actor.mapped ? this.#actor.height : 0;
        this.clear();
        if (merged.topHit) {
            const _ = this.#gettext;
            this.#addHeading(_('Top Hit'));
            this.#addRow(merged.topHit);
        }
        for (const section of merged.sections) {
            this.#addHeading(section.title);
            for (const item of section.items)
                this.#addRow(item);
        }
        this.select(selectedKey);
        if (animate)
            this.#easeHeight(from);
        else
            this.resetHeight();
    }

    /** Back to the natural height, whatever animation was running. */
    resetHeight() {
        this.#actor.remove_all_transitions();
        this.#actor.set_height(-1);
    }

    // The list grows or shrinks from what it showed to what it needs, instead of jumping; the
    // search field above does not move. Ends with no fixed height at all, so it is exactly the
    // natural one.
    #easeHeight(from) {
        const actor = this.#actor;
        actor.remove_all_transitions();
        actor.set_height(-1);
        const [, natural] = actor.get_preferred_height(actor.width > 0 ? actor.width : -1);
        if (!needsHeightEase(from, natural))
            return;
        actor.set_height(from);
        actor.ease({
            height: natural,
            duration: HEIGHT_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: isFinished => {
                if (isFinished)
                    actor.set_height(-1);
            },
        });
    }

    select(key) {
        for (const [rowKey, row] of this.#rows) {
            if (rowKey === key) {
                row.add_style_pseudo_class('selected');
                setSelected(row, true);
                compat.ensureVisible(this.#actor, row);
            } else {
                row.remove_style_pseudo_class('selected');
                setSelected(row, false);
            }
        }
    }

    clear() {
        this.#rows.clear();
        this.#box.destroy_all_children();
    }

    #addHeading(text) {
        this.#box.add_child(new St.Label({style_class: 'luciole-section-title', text}));
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
        describeResult(row, result.title, result.subtitle);
        row.connect('clicked', () => this.#onActivate(item));

        this.#rows.set(item.key, row);
        this.#box.add_child(row);
    }
}
