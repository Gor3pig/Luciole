import {fold} from '../core/text.js';

/**
 * What the provider needs to know about an installed application.
 *
 * @typedef {object} AppDescriptor
 * @property {string} id - desktop file id, e.g. "org.mozilla.firefox.desktop"
 * @property {string} name
 * @property {string} [genericName]
 * @property {string[]} [keywords]
 * @property {string} [description]
 * @property {unknown} [icon] - a Gio.Icon
 */

const WEIGHT = {NAME: 1, GENERIC_NAME: 0.6, KEYWORD: 0.5, ID: 0.4};

function firstLine(text) {
    return (text ?? '').split('\n')[0].trim();
}

/**
 * Builds the results for a list of applications. Pure: the shell side only
 * has to describe the applications, and matching texts are folded once here
 * so a keystroke never has to fold them again.
 *
 * Applications without an id or a name are skipped, and an id seen twice is
 * kept once.
 *
 * @param {AppDescriptor[]} descriptors
 * @returns {import('../core/provider.js').Result[]}
 */
export function buildAppResults(descriptors) {
    const seen = new Set();
    const results = [];
    for (const app of descriptors) {
        if (!app || !app.id || !app.name || seen.has(app.id))
            continue;
        seen.add(app.id);

        const fields = [{text: app.name, weight: WEIGHT.NAME}];
        if (app.genericName)
            fields.push({text: app.genericName, weight: WEIGHT.GENERIC_NAME});
        for (const keyword of app.keywords ?? []) {
            if (keyword)
                fields.push({text: keyword, weight: WEIGHT.KEYWORD});
        }
        fields.push({text: app.id.replace(/\.desktop$/, ''), weight: WEIGHT.ID});

        results.push({
            id: app.id,
            title: app.name,
            subtitle: firstLine(app.genericName) || firstLine(app.description),
            icon: app.icon,
            matchFields: fields.map(field => ({...field, folded: fold(field.text)})),
            frecencyKey: `apps:${app.id}`,
        });
    }
    return results;
}

/** Finds results by their id, keeping the order of the ids. Unknown ids are skipped. */
export function pickByIds(results, ids) {
    const byId = new Map(results.map(result => [result.id, result]));
    return ids.map(id => byId.get(id)).filter(result => result !== undefined);
}
