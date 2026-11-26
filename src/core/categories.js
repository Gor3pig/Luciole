// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Restricting a search to one source ("category"): which categories there are, which one a
// shortcut means, and which digit a key press stands for. Pure functions; the window and the
// controller do the rest.

/**
 * The categories to offer: one per source, in the order the sources are listed. With fewer
 * than two sources there is nothing to choose between, so none are offered.
 *
 * @param {Array<{id: string, name: string}>} providers
 * @returns {Array<{id: string, name: string}>}
 */
export function categoriesOf(providers) {
    if (!Array.isArray(providers))
        return [];
    const seen = new Set();
    const list = [];
    for (const provider of providers) {
        if (typeof provider?.id !== 'string' || provider.id === '' || seen.has(provider.id))
            continue;
        seen.add(provider.id);
        list.push({id: provider.id, name: typeof provider.name === 'string' && provider.name !== '' ? provider.name : provider.id});
    }
    return list.length >= 2 ? list : [];
}

/**
 * What a digit selects: 0 is everything (null), 1 to 9 the n-th category. undefined when there
 * is no such category (the key then does nothing).
 *
 * @param {number} digit
 * @param {Array<{id: string}>} categories
 * @returns {string | null | undefined}
 */
export function categoryForDigit(digit, categories) {
    if (!Number.isInteger(digit) || digit < 0 || digit > 9 || !Array.isArray(categories) || categories.length === 0)
        return undefined;
    if (digit === 0)
        return null;
    return categories[digit - 1]?.id;
}

/**
 * The filter to really apply: the chosen source if it is still there, else everything. (A source
 * may have been switched off in the preferences since it was chosen.)
 *
 * @param {string | null | undefined} id
 * @param {Array<{id: string}>} providers
 * @returns {string | null}
 */
export function effectiveFilter(id, providers) {
    if (typeof id !== 'string' || !Array.isArray(providers))
        return null;
    return providers.some(provider => provider?.id === id) ? id : null;
}

// XKB key codes of the digit row (evdev code + 8): '1' is 10 ... '9' is 18, '0' is 19.
const FIRST_DIGIT_KEYCODE = 10;
const KEYPAD_ZERO = 0xffb0;
const ASCII_ZERO = 0x30;

/**
 * The digit a key press stands for, or null. The digit row is read by its position, not by what
 * it types: on a French keyboard the unshifted row types & é " ' ( ... and the shortcuts must
 * still be Ctrl+1, Ctrl+2... on those keys. The keypad is read by its symbol.
 *
 * @param {{keyval: number, keycode: number}} key
 * @returns {number | null}
 */
export function digitOfKey({keyval, keycode}) {
    if (Number.isInteger(keycode) && keycode >= FIRST_DIGIT_KEYCODE && keycode <= FIRST_DIGIT_KEYCODE + 9)
        return (keycode - FIRST_DIGIT_KEYCODE + 1) % 10;
    if (Number.isInteger(keyval) && keyval >= KEYPAD_ZERO && keyval <= KEYPAD_ZERO + 9)
        return keyval - KEYPAD_ZERO;
    if (Number.isInteger(keyval) && keyval >= ASCII_ZERO && keyval <= ASCII_ZERO + 9)
        return keyval - ASCII_ZERO;
    return null;
}
