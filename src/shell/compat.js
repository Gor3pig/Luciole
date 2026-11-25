// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// The only module that talks to GNOME Shell internals and the only place where
// differences between shell versions are handled. Everything else in the
// extension goes through these functions.
//
// Verified against GNOME Shell 51.1 (source read from the shell resources).
// GNOME Shell 50 is declared in metadata.json but has NOT been checked here
// yet: the functions below are assumed identical until a test on 50 says
// otherwise.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ensureActorVisibleInScrollView} from 'resource:///org/gnome/shell/misc/animationUtils.js';
import {PACKAGE_VERSION} from 'resource:///org/gnome/shell/misc/config.js';

export const SHELL_MAJOR_VERSION = parseInt(PACKAGE_VERSION.split('.')[0], 10);

/**
 * Registers a global keyboard shortcut backed by a GSettings key of type 'as'.
 * The shell follows later changes of the key by itself.
 */
export function addKeybinding(settings, key, handler) {
    Main.wm.addKeybinding(
        key,
        settings,
        Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
        // POPUP is the mode while the launcher holds the keyboard: without it the
        // shortcut could open the launcher but never close it again.
        Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
        handler);
}

export function removeKeybinding(key) {
    Main.wm.removeKeybinding(key);
}

/** Grabs keyboard and pointer for an actor. Returns the grab to hand to popModal(). */
export function pushModal(actor) {
    return Main.pushModal(actor, {actionMode: Shell.ActionMode.POPUP});
}

export function popModal(grab) {
    Main.popModal(grab);
}

export function addToUiGroup(actor) {
    Main.uiGroup.add_child(actor);
}

/** Geometry {x, y, width, height} of the monitor the pointer is on. */
export function currentMonitor() {
    return Main.layoutManager.currentMonitor ?? Main.layoutManager.primaryMonitor;
}

export function isScreenLocked() {
    return Main.screenShield?.locked ?? false;
}

/** False when the user disabled animations or asked for reduced motion. */
export function useMotion() {
    const settings = St.Settings.get();
    return settings.enable_animations &&
        settings.reducedMotion !== St.ReducedMotion.REDUCE;
}

export function connectScreenLock(disposables, handler) {
    const shield = Main.screenShield;
    if (!shield)
        return;
    disposables.connect(shield, 'locked-changed', handler);
    disposables.connect(shield, 'active-changed', handler);
}

export function connectSessionModeChanged(disposables, handler) {
    disposables.connect(Main.sessionMode, 'updated', handler);
}

export function connectMonitorsChanged(disposables, handler) {
    disposables.connect(Main.layoutManager, 'monitors-changed', handler);
}

/** The actor that currently receives the keyboard, or null. */
export function keyFocusActor() {
    return global.stage.get_key_focus();
}

/** The actor a pointer or touch event is aimed at, or null. */
export function eventActor(event) {
    return global.stage.get_event_actor(event);
}

/** Calls `handler` whenever the keyboard focus moves; returns a function that stops it. */
export function connectKeyFocus(handler) {
    const id = global.stage.connect('notify::key-focus', handler);
    return () => global.stage.disconnect(id);
}

/** Scrolls a St.ScrollView so that one of its descendants is fully visible. */
export function ensureVisible(scrollView, actor) {
    ensureActorVisibleInScrollView(scrollView, actor);
}
