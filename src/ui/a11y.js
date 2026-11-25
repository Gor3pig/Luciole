import Atk from 'gi://Atk';

// Roles and labels for screen readers. They only name things; nothing here
// changes how the window looks or behaves.

/** Marks the window as a dialog and gives it a spoken name. */
export function describeWindow(actor, label) {
    actor.accessible_role = Atk.Role.DIALOG;
    actor.accessible_name = label;
}

/** The results container is a list. */
export function describeList(actor, label) {
    actor.accessible_role = Atk.Role.LIST;
    actor.accessible_name = label;
}

/** A result is read as its title and its detail, e.g. "Firefox, Web Browser". */
export function describeResult(actor, title, subtitle) {
    actor.accessible_name = subtitle ? `${title}, ${subtitle}` : title;
}

/** Tells assistive technology which result is the selected one. */
export function setSelected(actor, selected) {
    if (selected)
        actor.add_accessible_state(Atk.StateType.SELECTED);
    else
        actor.remove_accessible_state(Atk.StateType.SELECTED);
}
