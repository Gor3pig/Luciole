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
    #onContextMenu;
    #hintFor;
    // A short note at the end of the selected row ("Space: preview"), by key.
    #hints = new Map();
    #rows = new Map();

    constructor({gettext, onActivate, onContextMenu = () => {}, hintFor = () => null}) {
        this.#gettext = gettext;
        this.#onActivate = onActivate;
        this.#onContextMenu = onContextMenu;
        this.#hintFor = hintFor;
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
            const hint = this.#hints.get(rowKey);
            if (rowKey === key) {
                row.add_style_pseudo_class('selected');
                setSelected(row, true);
                compat.ensureVisible(this.#actor, row);
                const text = hint ? this.#hintFor(hint.item) : null;
                if (hint) {
                    hint.label.text = text ?? '';
                    hint.label.visible = Boolean(text);
                }
            } else {
                row.remove_style_pseudo_class('selected');
                setSelected(row, false);
                if (hint)
                    hint.label.visible = false;
            }
        }
    }

    // Where a menu opened from the keyboard goes: just under the start of the row's name, like the
    // menu key in Files. Null when the row is not shown.
    menuPoint(key) {
        const row = this.#rows.get(key);
        if (!row?.mapped)
            return null;
        const [, rowY] = row.get_transformed_position();
        const [, rowHeight] = row.get_transformed_size();
        // The row's content: its icon, then the box of its name and place.
        const text = row.get_child()?.get_children()[1];
        const [x] = (text ?? row).get_transformed_position();
        return {x, y: rowY + rowHeight};
    }

    // The result whose row holds an actor (what a click landed on), or null.
    itemAt(actor) {
        for (const [key, row] of this.#rows) {
            if (actor && row.contains(actor))
                return this.#hints.get(key)?.item ?? null;
        }
        return null;
    }

    clear() {
        this.#rows.clear();
        this.#hints.clear();
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

        const content = new St.BoxLayout({style_class: 'luciole-row-content', x_expand: true});
        content.add_child(new St.Icon({
            style_class: 'luciole-row-icon',
            ...(result.icon instanceof Gio.Icon
                ? {gicon: result.icon}
                : {icon_name: typeof result.icon === 'string' ? result.icon : FALLBACK_ICON}),
        }));
        content.add_child(text);
        const hint = new St.Label({style_class: 'luciole-row-hint', y_align: Clutter.ActorAlign.CENTER, visible: false});
        content.add_child(hint);

        const row = new St.Button({
            style_class: 'luciole-row',
            can_focus: false,
            x_expand: true,
            child: content,
            // The left button opens the result, the right one shows its actions.
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
        });
        describeResult(row, result.title, result.subtitle);
        row.connect('clicked', (_row, button) => {
            if (button === Clutter.BUTTON_SECONDARY)
                this.#onContextMenu(item);
            else
                this.#onActivate(item);
        });

        this.#rows.set(item.key, row);
        this.#hints.set(item.key, {label: hint, item});
        this.#box.add_child(row);
    }
}
