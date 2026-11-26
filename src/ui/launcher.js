// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {ActionMenu} from '../core/action-menu.js';
import {categoryForDigit, digitOfKey} from '../core/categories.js';
import {backdropClass, motionEnabled, verticalLayout} from '../core/layout.js';
import {jumpSection, nextSelection} from '../core/merge.js';
import {HistoryCursor} from '../core/query-history.js';
import * as compat from '../shell/compat.js';
import {describeList, describeWindow, setSelected} from './a11y.js';
import {ResultsView} from './results-view.js';

const OPEN_MS = 120;
const CLOSE_MS = 90;
const SLIDE_PX = 8;
// Longest text the search field takes (typed or pasted); a query is a few words.
const MAX_QUERY_LENGTH = 256;
// How long "copied" stays on screen before the window closes.
const CONFIRMATION_MS = 600;

/**
 * Keys that mean "I am going elsewhere": the Super key (Activities) and Alt+Tab
 * (windows). While the launcher holds the keyboard the shell ignores them, so
 * the launcher closes instead of leaving the user facing a window that seems
 * to ignore the system.
 */
function isLeaveKey(event) {
    const symbol = event.get_key_symbol();
    if (symbol === Clutter.KEY_Super_L || symbol === Clutter.KEY_Super_R)
        return true;
    const alt = (event.get_state() & Clutter.ModifierType.MOD1_MASK) !== 0;
    return alt && (symbol === Clutter.KEY_Tab || symbol === Clutter.KEY_ISO_Left_Tab);
}

/**
 * The floating launcher window: a full-monitor overlay that holds the input
 * grab, with the panel centred near the top. Appearance lives entirely in
 * stylesheet.css (and its dark variant); this file only assigns style classes.
 *
 * Actors are built on first open and kept hidden afterwards, so reopening is
 * cheap. destroy() releases everything.
 */
export class Launcher {
    #log;
    #gettext;
    #onQuery;
    #onActivate;
    #onSecondary;
    #getBackdrop;
    #getAnimations;
    #getQueries;
    #getCategories;
    #getActions;
    #getSubActions;
    #onRunAction;
    #menu = new ActionMenu();
    #menuToken = 0;
    #menuItem = null;
    #menuBox = null;
    #menuRows = null;
    #confirmTimer = 0;
    #onFilter;
    #categories = [];
    #filter = null;
    #chipBox = null;
    #chips = new Map();
    #emptyHint = null;
    #history = new HistoryCursor();
    #recalling = false;
    #hint = null;
    #overlay = null;
    #panel = null;
    #entry = null;
    #view = null;
    #grab = null;
    #stopFocusWatch = null;
    #isOpen = false;
    #items = [];
    #merged = null;
    #selectedKey = null;
    #navigated = false;
    #settled = false;
    #queryAt = 0;
    #doneAt = 0;

    /**
     * @param {object} options
     * @param {object} options.log
     * @param {(text: string) => string} options.gettext
     * @param {(query: string) => void} options.onQuery - the text changed (also called with '' on open)
     * @param {(item: object) => void} options.onActivate - the user chose a result
     * @param {(item: object) => void} options.onSecondary - the user asked for the other action (Ctrl+Enter)
     * @param {() => string} options.getBackdrop - the dimming setting: 'none', 'light' or 'standard'
     * @param {() => boolean} options.getAnimations - the animations setting
     * @param {() => string[]} options.getQueries - the remembered searches, newest first
     * @param {() => Array<{id: string, name: string}>} options.getCategories - the sources a search can be restricted to
     * @param {(id: string | null) => void} options.onFilter - the search is restricted to a source (null: all)
     * @param {(item: object) => Promise<object[]>} options.getActions - the actions of a result, for its menu
     * @param {(item: object, action: object) => Promise<object[]>} options.getSubActions - what a submenu action leads to
     * @param {(item: object, action: object) => Promise<{ok: boolean, confirmation: string | null}>} options.onRunAction - runs an action
     */
    constructor({log, gettext, onQuery, onActivate, onSecondary, getBackdrop, getAnimations, getQueries = () => [], getCategories = () => [], onFilter = () => {},
        getActions = async () => [], getSubActions = async () => [], onRunAction = async () => ({ok: false, confirmation: null})}) {
        this.#log = log;
        this.#gettext = gettext;
        this.#onQuery = onQuery;
        this.#onActivate = onActivate;
        this.#onSecondary = onSecondary;
        this.#getBackdrop = getBackdrop;
        this.#getAnimations = getAnimations;
        this.#getQueries = getQueries;
        this.#getCategories = getCategories;
        this.#onFilter = onFilter;
        this.#getActions = getActions;
        this.#getSubActions = getSubActions;
        this.#onRunAction = onRunAction;
    }

    // Read at every use, so a change in the preferences applies at once.
    #motion() {
        const preference = this.#log.guard('reading the animations setting', () => this.#getAnimations(), true);
        return motionEnabled(compat.useMotion(), preference);
    }

    get isOpen() {
        return this.#isOpen;
    }

    toggle() {
        if (this.#isOpen)
            this.close();
        else
            this.open();
    }

    open() {
        if (this.#isOpen || compat.isScreenLocked())
            return;

        this.#ensureBuilt();
        this.#place();
        this.#applyBackdrop();
        this.#items = [];
        this.#merged = null;
        this.#selectedKey = null;
        this.#navigated = false;
        this.#history.reset();
        this.#entry.set_text('');
        this.#showHint();
        this.#resetMenu();
        this.#hideMenu();
        // Every opening starts on "All", like the empty field.
        this.#filter = null;
        this.#log.guard('resetting the category', () => this.#onFilter(null));
        this.#buildChips();
        this.#overlay.remove_all_transitions();
        this.#panel.remove_all_transitions();
        this.#view.resetHeight();
        // What the first search puts in the list while opening appears with the window.
        this.#settled = false;
        this.#overlay.show();

        try {
            this.#grab = compat.pushModal(this.#overlay);
        } catch (error) {
            this.#log.error('could not grab the keyboard', error);
            this.#overlay.hide();
            return;
        }
        this.#isOpen = true;
        this.#entry.grab_key_focus();
        // If the keyboard goes anywhere else (the overview taking it, a dialog, a
        // widget that disappears), nothing typed would reach the launcher any more
        // and it could not even be closed with Escape: it closes instead.
        this.#stopFocusWatch = compat.connectKeyFocus(() => this.#checkFocus());
        this.#log.debug('opened');
        // The clock of the "query to results" timings starts now, not at the last typed key.
        this.#queryAt = GLib.get_monotonic_time();
        this.#doneAt = this.#queryAt;
        this.#log.guard('searching the recent items', () => this.#onQuery(''));
        this.#settled = true;

        if (this.#motion()) {
            this.#overlay.opacity = 0;
            this.#panel.translation_y = -SLIDE_PX;
            this.#overlay.ease({
                opacity: 255,
                duration: OPEN_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            this.#panel.ease({
                translation_y: 0,
                duration: OPEN_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            this.#overlay.opacity = 255;
            this.#panel.translation_y = 0;
        }
    }

    close() {
        if (!this.#isOpen)
            return;
        this.#isOpen = false;
        this.#resetMenu();
        this.#unwatchFocus();
        this.#releaseGrab();
        this.#view.clear();
        this.#view.resetHeight();
        this.#log.debug('closed');

        const overlay = this.#overlay;
        if (this.#motion()) {
            overlay.ease({
                opacity: 0,
                duration: CLOSE_MS,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (!this.#isOpen && this.#overlay === overlay)
                        overlay.hide();
                },
            });
        } else {
            overlay.hide();
        }
    }

    /**
     * Shows what the search found. The selection follows the best result until
     * the user moves it, then stays on the same item as results come in.
     *
     * @param {ReturnType<import('../core/merge.js').mergeResults>} merged
     * @param {{done: boolean}} [state] - done when every provider has answered
     */
    showResults(merged, state = {done: false}) {
        if (!this.#view || !this.#isOpen)
            return;
        this.#merged = merged;
        this.#items = merged.items;
        this.#selectedKey = nextSelection(this.#selectedKey, this.#items, this.#navigated);
        this.#view.update(merged, this.#selectedKey, this.#settled && this.#motion());
        if (this.#queryAt) {
            const ms = (GLib.get_monotonic_time() - this.#queryAt) / 1000;
            this.#log.debug(`perf query to results: ${ms.toFixed(2)} ms`);
            this.#queryAt = 0;
        }
        if (state.done && this.#doneAt) {
            const ms = (GLib.get_monotonic_time() - this.#doneAt) / 1000;
            this.#log.debug(`perf query to final results: ${ms.toFixed(2)} ms`);
        }
        this.#updateEmptyHint(state.done);
        const first = merged.topHit ?? merged.items[0];
        this.#log.debug(`results: ${merged.items.length} first=${first ? first.result.title : '-'} query=${this.#entry.get_text()}`);
    }

    destroy() {
        this.#isOpen = false;
        this.#resetMenu();
        this.#unwatchFocus();
        this.#releaseGrab();
        if (this.#overlay) {
            this.#overlay.remove_all_transitions();
            this.#panel.remove_all_transitions();
            this.#overlay.destroy();
        }
        this.#overlay = null;
        this.#panel = null;
        this.#entry = null;
        this.#view = null;
        this.#items = [];
    }

    #moveSelection(delta) {
        if (this.#items.length === 0)
            return;
        const current = this.#items.findIndex(item => item.key === this.#selectedKey);
        const next = Math.min(this.#items.length - 1, Math.max(0, current + delta));
        this.#choose(this.#items[next].key);
        this.#navigated = true;
    }

    #choose(key) {
        this.#selectedKey = key;
        this.#view.select(key);
        this.#log.debug(`selected: ${key}`);
    }

    #jumpSection(direction) {
        if (!this.#merged)
            return;
        const key = jumpSection(this.#merged, this.#selectedKey, direction);
        if (key === null)
            return;
        this.#choose(key);
        this.#navigated = true;
    }

    #activate(item) {
        this.#log.guard('activating a result', () => this.#onActivate(item));
        this.close();
    }

    #activateSecondary() {
        const item = this.#items.find(candidate => candidate.key === this.#selectedKey);
        if (!item)
            return;
        this.#log.guard('running the secondary action', () => this.#onSecondary(item));
        this.close();
    }

    #activateSelected() {
        const item = this.#items.find(candidate => candidate.key === this.#selectedKey);
        if (item)
            this.#activate(item);
    }

    // The chips under the field: "All" and one per source; none when there is nothing to choose.
    #buildChips() {
        const list = this.#log.guard('reading the categories', () => this.#getCategories(), []);
        this.#categories = Array.isArray(list) ? list : [];
        this.#emptyHint.hide();
        this.#chipBox.destroy_all_children();
        this.#chips.clear();
        if (this.#categories.length === 0) {
            this.#chipBox.hide();
        } else {
            const _ = this.#gettext;
            for (const category of [{id: null, name: _('All')}, ...this.#categories]) {
                const chip = new St.Button({
                    style_class: 'luciole-chip',
                    label: category.name,
                    // Reached with Ctrl+digit or the pointer: Tab keeps jumping between sections.
                    can_focus: false,
                    reactive: true,
                    track_hover: true,
                });
                chip.accessible_role = Atk.Role.TOGGLE_BUTTON;
                chip.accessible_name = category.name;
                chip.connect('clicked', () => this.#setFilter(category.id));
                this.#chipBox.add_child(chip);
                this.#chips.set(category.id, chip);
            }
            this.#chipBox.show();
        }
        this.#markChips();
        this.#updateFilterTexts();
    }

    #markChips() {
        for (const [id, chip] of this.#chips) {
            const selected = id === this.#filter;
            chip.set_checked(selected);
            if (selected)
                chip.add_accessible_state(Atk.StateType.CHECKED);
            else
                chip.remove_accessible_state(Atk.StateType.CHECKED);
        }
    }

    // Ctrl+0 (all), Ctrl+1, Ctrl+2... (the sources in order). True when the key was one of them.
    #categoryShortcut(event) {
        const digit = digitOfKey({keyval: event.get_key_symbol(), keycode: event.get_key_code()});
        if (digit === null)
            return false;
        const id = categoryForDigit(digit, this.#categories);
        if (id === undefined)
            return false;
        this.#setFilter(id);
        return true;
    }

    #setFilter(id) {
        if (id === this.#filter || !this.#isOpen)
            return;
        this.#filter = id;
        this.#log.guard('restricting the search', () => this.#onFilter(id));
        this.#markChips();
        this.#updateFilterTexts();
        this.#emptyHint.hide();
        // The text stays; what is found for it changes.
        this.#queryAt = GLib.get_monotonic_time();
        this.#doneAt = this.#queryAt;
        this.#navigated = false;
        this.#log.guard('searching', () => this.#onQuery(this.#entry.get_text()));
    }

    // What the field and the empty list say once a source is chosen.
    #updateFilterTexts() {
        const _ = this.#gettext;
        const name = this.#categories.find(category => category.id === this.#filter)?.name ?? '';
        const searching = {apps: _('Search applications'), files: _('Search files')};
        this.#entry.hint_text = this.#filter === null
            ? _('Search applications and files')
            : searching[this.#filter] ?? _('Search %s').format(name);
    }

    // Shown only when a source is chosen, the field is empty and that source has nothing to list
    // before something is typed (files have no "recent" list).
    #updateEmptyHint(done) {
        const _ = this.#gettext;
        const waiting = {apps: _('Type to search your applications'), files: _('Type to search your files')};
        const show = done && this.#filter !== null && this.#entry.get_text() === '' && this.#items.length === 0;
        if (show)
            this.#emptyHint.set_text(waiting[this.#filter] ?? _('Type to search in this category'));
        this.#emptyHint.visible = show;
    }

    // ---- The menu of actions of the selected result (Ctrl+K) ----

    async #openMenu() {
        const item = this.#items.find(candidate => candidate.key === this.#selectedKey);
        if (!item || !this.#isOpen)
            return;
        const token = ++this.#menuToken;
        const actions = await this.#log.guardAsync('listing the actions', () => this.#getActions(item), []);
        // The window may have closed, or the user done something else, while the actions were listed.
        if (token !== this.#menuToken || !this.#isOpen)
            return;
        this.#menuItem = item;
        this.#menu.open(item.result.title, actions);
        this.#showMenu();
    }

    // Keys while a menu is shown. True when the key was used (typing is left to the field, which
    // then leaves the menu).
    #menuKey(symbol, control) {
        if (this.#confirmTimer)
            return true;
        switch (symbol) {
        case Clutter.KEY_Down:
            this.#menu.move(1);
            this.#showMenu();
            return true;
        case Clutter.KEY_Up:
            this.#menu.move(-1);
            this.#showMenu();
            return true;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
            // Enter reaches the field as its "activate" signal (see the handler there), which runs
            // the highlighted action; Ctrl+Enter would act on the hidden list, so it is swallowed.
            return control;
        case Clutter.KEY_Escape:
            this.#menuBack();
            return true;
        case Clutter.KEY_Tab:
        case Clutter.KEY_ISO_Left_Tab:
            return true;
        default:
            // Other shortcuts would act on the list hidden behind the menu.
            return control;
        }
    }

    #menuBack() {
        this.#menuToken++;
        if (this.#menu.back())
            this.#showMenu();
        else
            this.#hideMenu();
    }

    async #runMenuAction() {
        const action = this.#menu.selected;
        const item = this.#menuItem;
        if (!action || !item)
            return;
        const token = ++this.#menuToken;
        const stale = () => token !== this.#menuToken || !this.#isOpen || !this.#menu.isOpen;
        if (action.submenu) {
            const choices = await this.#log.guardAsync('listing the choices', () => this.#getSubActions(item, action), []);
            if (stale())
                return;
            if (this.#menu.push(action.label, choices))
                this.#showMenu();
            return;
        }
        const outcome = await this.#log.guardAsync('running an action', () => this.#onRunAction(item, action), {ok: false, confirmation: null});
        if (stale())
            return;
        // A failed action (it is logged) leaves the window open, so the user can try another.
        if (!outcome.ok)
            return;
        if (outcome.confirmation)
            this.#showConfirmation(outcome.confirmation);
        else
            this.close();
    }

    #showConfirmation(text) {
        this.#menuRows.destroy_all_children();
        const row = new St.BoxLayout({style_class: 'luciole-menu-confirmation'});
        row.add_child(new St.Icon({icon_name: 'object-select-symbolic', style_class: 'luciole-menu-check'}));
        row.add_child(new St.Label({text, y_align: Clutter.ActorAlign.CENTER}));
        this.#menuRows.add_child(row);
        this.#confirmTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CONFIRMATION_MS, () => {
            this.#confirmTimer = 0;
            this.close();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Draws the menu at its current level, in place of the results.
    #showMenu() {
        const menu = this.#menu;
        this.#menuRows.destroy_all_children();
        const item = this.#menuItem;
        const _ = this.#gettext;
        const heading = menu.depth > 1
            ? _('Open “%s” with').format(item?.result.title ?? '')
            : _('Actions for');
        this.#menuRows.add_child(new St.Label({style_class: 'luciole-menu-heading', text: heading}));
        if (menu.depth === 1) {
            this.#menuRows.add_child(new St.Label({style_class: 'luciole-menu-title', text: menu.title}));
            if (item?.result.subtitle)
                this.#menuRows.add_child(new St.Label({style_class: 'luciole-menu-subtitle', text: item.result.subtitle}));
        }
        menu.actions.forEach((action, index) => {
            const row = new St.Button({style_class: 'luciole-menu-row', can_focus: false, reactive: true, track_hover: true, x_expand: true});
            const content = new St.BoxLayout({x_expand: true});
            content.add_child(new St.Label({text: action.label, x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
            const hint = action.submenu ? '›' : action.hint;
            if (hint)
                content.add_child(new St.Label({style_class: 'luciole-menu-hint', text: hint, y_align: Clutter.ActorAlign.CENTER}));
            row.set_child(content);
            row.accessible_name = action.label;
            const selected = index === menu.index;
            if (selected)
                row.add_style_pseudo_class('selected');
            setSelected(row, selected);
            row.connect('clicked', () => {
                menu.select(index);
                this.#showMenu();
                this.#log.guardAsync('running an action', () => this.#runMenuAction());
            });
            this.#menuRows.add_child(row);
        });
        this.#chipBox.hide();
        this.#emptyHint.hide();
        this.#view.actor.hide();
        this.#menuBox.show();
    }

    #hideMenu() {
        this.#menuBox.hide();
        this.#view.actor.show();
        this.#chipBox.visible = this.#categories.length > 0;
    }

    // Closes the menu and shows the results again.
    #closeMenu() {
        if (!this.#menu.isOpen && !this.#confirmTimer)
            return;
        this.#resetMenu();
        this.#hideMenu();
    }

    // Forgets the menu, wherever it was: pending answers become stale, the timer stops.
    #resetMenu() {
        this.#menuToken++;
        this.#menu.close();
        this.#menuItem = null;
        if (this.#confirmTimer) {
            GLib.source_remove(this.#confirmTimer);
            this.#confirmTimer = 0;
        }
    }

    // The remembered searches, read at each use (the setting may have changed).
    #queries() {
        const list = this.#log.guard('reading the remembered searches', () => this.#getQueries(), []);
        return Array.isArray(list) ? list : [];
    }

    // Puts a remembered search in the field (selected, so typing replaces it) and searches for it.
    // null means there was nothing to bring back; '' means back to the empty field.
    #recall(text) {
        if (text === null)
            return;
        this.#recalling = true;
        try {
            this.#entry.set_text(text);
            this.#entry.clutter_text.set_selection(0, -1);
        } finally {
            this.#recalling = false;
        }
        this.#showHint();
    }

    #showHint() {
        if (!this.#hint)
            return;
        const where = this.#history.where(this.#queries());
        if (!where) {
            this.#hint.hide();
            return;
        }
        const _ = this.#gettext;
        this.#hint.set_text(_('Previous search %d of %d').format(where.position, where.total));
        this.#hint.show();
    }

    #checkFocus() {
        if (!this.#isOpen || !this.#overlay)
            return;
        const focus = compat.keyFocusActor();
        if (focus && this.#overlay.contains(focus))
            return;
        this.#log.debug('keyboard focus left the launcher');
        this.close();
    }

    #unwatchFocus() {
        const stop = this.#stopFocusWatch;
        this.#stopFocusWatch = null;
        if (stop)
            stop();
    }

    #releaseGrab() {
        const grab = this.#grab;
        this.#grab = null;
        if (!grab)
            return;
        try {
            compat.popModal(grab);
        } catch (error) {
            this.#log.error('could not release the keyboard', error);
        }
    }

    #place() {
        const monitor = compat.activeMonitor();
        if (!monitor)
            return;
        const {top, resultsMax} = verticalLayout(monitor.height);
        this.#overlay.set_position(monitor.x, monitor.y);
        this.#overlay.set_size(monitor.width, monitor.height);
        this.#overlay.set_style(`padding-top: ${top}px;`);
        this.#view.setMaxHeight(resultsMax);
    }

    // Read at every opening, so a change in the preferences applies at once.
    #applyBackdrop() {
        const level = this.#log.guard('reading the backdrop setting', () => this.#getBackdrop(), 'none');
        const extra = backdropClass(level);
        this.#overlay.set_style_class_name(extra ? `luciole-overlay ${extra}` : 'luciole-overlay');
    }

    #ensureBuilt() {
        if (this.#overlay)
            return;

        const _ = this.#gettext;
        const entry = new St.Entry({
            style_class: 'luciole-entry',
            hint_text: _('Search applications and files'),
            can_focus: true,
            x_expand: true,
        });
        entry.set_primary_icon(new St.Icon({
            style_class: 'luciole-entry-icon',
            icon_name: 'edit-find-symbolic',
        }));
        entry.accessible_name = _('Search');
        // Shown while a remembered search is on screen (see #recall).
        const hint = new St.Label({style_class: 'luciole-history-hint', y_align: Clutter.ActorAlign.CENTER, visible: false});
        entry.set_secondary_icon(hint);
        this.#hint = hint;

        const view = new ResultsView({
            gettext: this.#gettext,
            onActivate: item => this.#activate(item),
        });

        const panel = new St.BoxLayout({
            style_class: 'luciole-panel',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
        });
        const chipBox = new St.BoxLayout({style_class: 'luciole-chips', visible: false});
        const emptyHint = new St.Label({style_class: 'luciole-empty-hint', visible: false});
        panel.add_child(entry);
        panel.add_child(chipBox);
        panel.add_child(emptyHint);
        panel.add_child(view.actor);
        const menuBox = new St.BoxLayout({style_class: 'luciole-menu', orientation: Clutter.Orientation.VERTICAL, visible: false});
        const menuRows = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        describeList(menuRows, _('Actions'));
        menuBox.add_child(menuRows);
        panel.add_child(menuBox);
        this.#menuBox = menuBox;
        this.#menuRows = menuRows;
        this.#chipBox = chipBox;
        this.#emptyHint = emptyHint;

        // A vertical box stacks its child from the top; x_align centres it.
        // (St.Bin ignores the alignment here, so it is not used.)
        panel.x_align = Clutter.ActorAlign.CENTER;
        const overlay = new St.BoxLayout({
            style_class: 'luciole-overlay',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
            visible: false,
        });
        overlay.add_child(panel);
        describeWindow(overlay, _('Luciole search'));

        const text = entry.clutter_text;
        text.max_length = MAX_QUERY_LENGTH;
        text.connect('text-changed', () => {
            // What is typed changes the search: the menu of the old result goes away.
            this.#closeMenu();
            // Typing, or Escape, leaves the remembered searches; bringing one back does not.
            if (!this.#recalling) {
                this.#history.reset();
                this.#showHint();
            }
            this.#queryAt = GLib.get_monotonic_time();
            this.#doneAt = this.#queryAt;
            this.#navigated = false;
            this.#log.guard('searching', () => this.#onQuery(entry.get_text()));
        });
        text.connect('activate', () => {
            if (this.#menu.isOpen) {
                if (!this.#confirmTimer)
                    this.#log.guardAsync('running an action', () => this.#runMenuAction());
            } else {
                this.#activateSelected();
            }
            return Clutter.EVENT_STOP;
        });
        text.connect('key-press-event', (_actor, event) => {
            if (isLeaveKey(event)) {
                this.close();
                return Clutter.EVENT_PROPAGATE;
            }
            const symbol = event.get_key_symbol();
            const control = (event.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0;
            if (control && (symbol === Clutter.KEY_k || symbol === Clutter.KEY_K)) {
                if (this.#menu.isOpen)
                    this.#closeMenu();
                else
                    this.#log.guardAsync('opening the actions menu', () => this.#openMenu());
                return Clutter.EVENT_STOP;
            }
            if (this.#menu.isOpen) {
                const handled = this.#menuKey(symbol, control);
                if (handled)
                    return Clutter.EVENT_STOP;
            }
            if (control && (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter)) {
                this.#activateSecondary();
                return Clutter.EVENT_STOP;
            }
            if (control && this.#categoryShortcut(event))
                return Clutter.EVENT_STOP;
            switch (symbol) {
            case Clutter.KEY_Down:
                // While going through the remembered searches, the arrows keep going through them.
                if (!this.#history.active)
                    this.#moveSelection(1);
                else
                    this.#recall(this.#history.newer(this.#queries()));
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Up:
                // In an empty field (nothing to choose from yet) the up arrow brings a search back.
                if (this.#history.active || entry.get_text() === '')
                    this.#recall(this.#history.older(this.#queries()));
                else
                    this.#moveSelection(-1);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Tab:
                this.#jumpSection(1);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_ISO_Left_Tab:
                this.#jumpSection(-1);
                return Clutter.EVENT_STOP;
            default:
                return Clutter.EVENT_PROPAGATE;
            }
        });

        overlay.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Escape)
                return Clutter.EVENT_PROPAGATE;
            // Escape clears the text first, then closes.
            if (entry.get_text() !== '')
                entry.set_text('');
            else
                this.close();
            return Clutter.EVENT_STOP;
        });

        overlay.connect('button-press-event', (_actor, event) => {
            // A click anywhere but on the panel closes the launcher.
            const target = compat.eventActor(event);
            if (target && panel.contains(target))
                return Clutter.EVENT_PROPAGATE;
            this.close();
            return Clutter.EVENT_STOP;
        });

        compat.addToUiGroup(overlay);
        this.#overlay = overlay;
        this.#panel = panel;
        this.#entry = entry;
        this.#view = view;
    }
}
