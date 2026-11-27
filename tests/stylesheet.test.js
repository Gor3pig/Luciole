// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// The shell loads stylesheet.css or stylesheet-dark.css depending on the
// colour scheme, never both. The two files must therefore describe exactly the
// same selectors and properties, or one theme would silently lose styling.

import Gio from 'gi://Gio';

import {assert, assertEquals, test} from './harness.js';

function readSource(name) {
    const file = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent()
        .get_child('src').get_child(name);
    const [, bytes] = file.load_contents(null);
    return new TextDecoder().decode(bytes);
}

/** Returns {selector: [property names, sorted]} for a simple flat stylesheet. */
function parse(css) {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = {};
    for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1].trim().replace(/\s+/g, ' ');
        const props = match[2].split(';')
            .map(declaration => declaration.split(':')[0].trim())
            .filter(name => name !== '');
        rules[selector] = props.sort();
    }
    return rules;
}

test('both stylesheets define the same selectors', () => {
    const light = parse(readSource('stylesheet.css'));
    const dark = parse(readSource('stylesheet-dark.css'));
    assert(Object.keys(light).length > 0, 'light stylesheet has no rules');
    assertEquals(Object.keys(dark).sort(), Object.keys(light).sort());
});

test('both stylesheets set the same properties in each rule', () => {
    const light = parse(readSource('stylesheet.css'));
    const dark = parse(readSource('stylesheet-dark.css'));
    for (const selector of Object.keys(light))
        assertEquals(dark[selector], light[selector], selector);
});

/** Returns {selector: {property: value}} for a simple flat stylesheet. */
function parseValues(css) {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = {};
    for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const values = {};
        for (const declaration of match[2].split(';')) {
            const [name, ...value] = declaration.split(':');
            if (name.trim() !== '')
                values[name.trim()] = value.join(':').trim().replace(/\s+/g, ' ');
        }
        rules[match[1].trim().replace(/\s+/g, ' ')] = values;
    }
    return rules;
}

// Only colours may differ between the themes: a property about colour or shadow by its name, or a
// value that holds one. Everything else (sizes, spacing, padding, radius, fonts) is the same.
const isColour = (property, value) => /color|shadow|gradient/.test(property) || /#[0-9a-f]{3,8}\b|rgba?\(/i.test(value);

test('both stylesheets give the same sizes, spacing and fonts: only colours differ', () => {
    const light = parseValues(readSource('stylesheet.css'));
    const dark = parseValues(readSource('stylesheet-dark.css'));
    let compared = 0;
    for (const [selector, values] of Object.entries(light)) {
        for (const [property, value] of Object.entries(values)) {
            if (isColour(property, value) || isColour(property, dark[selector]?.[property] ?? ''))
                continue;
            assertEquals(dark[selector]?.[property], value, `${selector} ${property}`);
            compared++;
        }
    }
    assert(compared > 20, `only ${compared} properties compared`);
});

test('every rule is scoped to the luciole- class prefix', () => {
    const light = parse(readSource('stylesheet.css'));
    for (const selector of Object.keys(light))
        assert(selector.includes('.luciole-'), `unscoped selector: ${selector}`);
});

function declared(css, selector, property) {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (match[1].trim() !== selector)
            continue;
        for (const declaration of match[2].split(';')) {
            const [name, ...value] = declaration.split(':');
            if (name.trim() === property)
                return value.join(':').trim();
        }
    }
    return null;
}

test('in both themes the window is not dimmed unless the backdrop option asks for it', () => {
    for (const name of ['stylesheet.css', 'stylesheet-dark.css']) {
        const css = readSource(name);
        assertEquals(declared(css, '.luciole-overlay', 'background-color'), 'transparent', `${name}: default`);
        assertEquals(declared(css, '.luciole-backdrop-light', 'background-color'), 'rgba(0, 0, 0, 0.22)', `${name}: light`);
        assertEquals(declared(css, '.luciole-backdrop-standard', 'background-color'), 'rgba(0, 0, 0, 0.5)', `${name}: standard`);
    }
});

test('the light stylesheet is also given under its own name, unchanged', () => {
    // GNOME Shell reloads an extension's stylesheet when the style changes only if its file name
    // says which style it is for: without stylesheet-light.css, it would stay light after the
    // session went back to dark. stylesheet.css stays as what the shell falls back to.
    assertEquals(readSource('stylesheet-light.css'), readSource('stylesheet.css'));
});

test('in every theme, a row under the pointer does not look chosen', () => {
    for (const name of ['stylesheet.css', 'stylesheet-light.css', 'stylesheet-dark.css']) {
        const css = readSource(name);
        const hover = declared(css, '.luciole-row:hover', 'background-color');
        const selected = declared(css, '.luciole-row:selected', 'background-color');
        assert(hover && selected, `${name}: both are set`);
        assert(hover !== selected, `${name}: the same tint for both`);
        assert(css.indexOf('.luciole-row:selected') > css.indexOf('.luciole-row:hover'), `${name}: the chosen one must come last, to win under the pointer`);
    }
});
