import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as compat from '../shell/compat.js';

const OPEN_MS = 120;
const CLOSE_MS = 90;
const SLIDE_PX = 8;
// Distance of the panel from the top of the monitor, as a fraction of its height.
const TOP_FRACTION = 0.18;

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
    #overlay = null;
    #panel = null;
    #entry = null;
    #grab = null;
    #isOpen = false;

    constructor({log, gettext}) {
        this.#log = log;
        this.#gettext = gettext;
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
        this.#entry.set_text('');
        this.#overlay.remove_all_transitions();
        this.#panel.remove_all_transitions();
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
        this.#log.debug('opened');

        if (compat.useMotion()) {
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
        this.#releaseGrab();
        this.#log.debug('closed');

        const overlay = this.#overlay;
        if (compat.useMotion()) {
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

    /** Recomputes the geometry, e.g. after a monitor change. */
    relayout() {
        if (this.#isOpen)
            this.#place();
    }

    destroy() {
        this.#isOpen = false;
        this.#releaseGrab();
        if (this.#overlay) {
            this.#overlay.remove_all_transitions();
            this.#panel.remove_all_transitions();
            this.#overlay.destroy();
        }
        this.#overlay = null;
        this.#panel = null;
        this.#entry = null;
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
        const monitor = compat.currentMonitor();
        if (!monitor)
            return;
        this.#overlay.set_position(monitor.x, monitor.y);
        this.#overlay.set_size(monitor.width, monitor.height);
        this.#overlay.set_style(
            `padding-top: ${Math.round(monitor.height * TOP_FRACTION)}px;`);
    }

    #ensureBuilt() {
        if (this.#overlay)
            return;

        const entry = new St.Entry({
            style_class: 'luciole-entry',
            hint_text: this.#gettext('Search applications and files'),
            can_focus: true,
            x_expand: true,
        });
        entry.set_primary_icon(new St.Icon({
            style_class: 'luciole-entry-icon',
            icon_name: 'edit-find-symbolic',
        }));
        entry.accessible_name = this.#gettext('Search');

        const panel = new St.BoxLayout({
            style_class: 'luciole-panel',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
        });
        panel.add_child(entry);

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
            // A click on the dimmed area outside the panel closes the launcher.
            if (event.get_source() !== overlay)
                return Clutter.EVENT_PROPAGATE;
            this.close();
            return Clutter.EVENT_STOP;
        });

        compat.addToUiGroup(overlay);
        this.#overlay = overlay;
        this.#panel = panel;
        this.#entry = entry;
    }
}
