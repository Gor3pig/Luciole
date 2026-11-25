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

test('every rule is scoped to the luciole- class prefix', () => {
    const light = parse(readSource('stylesheet.css'));
    for (const selector of Object.keys(light))
        assert(selector.includes('.luciole-'), `unscoped selector: ${selector}`);
});
