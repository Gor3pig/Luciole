// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {Frecency} from '../src/core/frecency.js';
import {createMatcher} from '../src/core/matching.js';
import {scoreResult} from '../src/core/scoring.js';
import {buildAppResults, pickByIds} from '../src/providers/apps-index.js';
import {assert, assertEquals, test} from './harness.js';

const NOW = 1_700_000_000_000;

// A realistic set, taken from a French desktop.
const APPS = [
    {id: 'org.mozilla.firefox.desktop', name: 'Firefox', genericName: 'Navigateur Web', keywords: ['web', 'browser', 'internet']},
    {id: 'org.gnome.Ptyxis.desktop', name: 'Terminal', genericName: 'Terminal', keywords: ['terminal', 'prompt', 'ptyxis']},
    {id: 'com.mitchellh.ghostty.desktop', name: 'Ghostty', keywords: ['terminal', 'tty', 'pty']},
    {id: 'org.gnome.Nautilus.desktop', name: 'Fichiers', keywords: ['dossier', 'gestionnaire', 'explorer']},
    {id: 'org.gnome.TextEditor.desktop', name: 'Éditeur de texte', genericName: 'Éditeur de texte', keywords: ['écrire', 'bloc-notes']},
    {id: 'org.gimp.GIMP.desktop', name: 'Éditeur d’image GIMP', genericName: 'Éditeur d’image', keywords: ['GIMP', 'graphisme']},
    {id: 'org.gnome.Characters.desktop', name: 'Caractères', keywords: ['caractères', 'unicode']},
    {id: 'org.gnome.Calculator.desktop', name: 'Calculatrice', keywords: ['calcul', 'arithmétique']},
    {id: 'org.gnome.clocks.desktop', name: 'Horloges', genericName: 'Horloges', keywords: ['heure', 'minuterie']},
    {id: 'org.fedoraproject.MediaWriter.desktop', name: 'Fedora Media Writer', keywords: ['fmw', 'usb', 'iso']},
];
const RESULTS = buildAppResults(APPS);

/** Titles of the matching apps, best first. */
function rank(query, frecency = null) {
    const matcher = createMatcher(query);
    return RESULTS
        .map(result => ({result, scored: scoreResult(result, matcher, frecency, NOW)}))
        .filter(entry => entry.scored)
        .sort((a, b) => b.scored.final - a.scored.final || a.result.title.length - b.result.title.length)
        .map(entry => entry.result.title);
}

test('"ff" finds Firefox', () => {
    assertEquals(rank('ff')[0], 'Firefox');
});

test('"term" finds Terminal first, and Ghostty through its keyword', () => {
    assertEquals(rank('term').slice(0, 2), ['Terminal', 'Ghostty']);
});

test('an accented keyword is found without typing the accent', () => {
    assertEquals(rank('ecrire'), ['Éditeur de texte']);
    assertEquals(rank('ecr')[0], 'Éditeur de texte');
});

test('an accented name is found with or without accents, in any case', () => {
    assertEquals(rank('caracteres')[0], 'Caractères');
    assertEquals(rank('CARACTÈRES')[0], 'Caractères');
    assertEquals(rank('edit').slice(0, 2).sort(), ['Éditeur d’image GIMP', 'Éditeur de texte'].sort());
});

test('an application is found through its generic name', () => {
    assertEquals(rank('navigateur'), ['Firefox']);
    assertEquals(rank('bloc'), ['Éditeur de texte'], 'and through a keyword with a hyphen');
});

test('the generic name is shown in preference to the description', () => {
    const [both] = buildAppResults([{id: 'a.desktop', name: 'A', genericName: 'Generic', description: 'Long description'}]);
    assertEquals(both.subtitle, 'Generic');
});

test('initials find a multi-word name', () => {
    assertEquals(rank('fmw')[0], 'Fedora Media Writer');
    assertEquals(rank('fmw').length, 1);
});

test('a part of the name found through a keyword ranks below the same match on the name', () => {
    const byName = rank('term');
    assert(byName.indexOf('Terminal') < byName.indexOf('Ghostty'), 'name before keyword');
});

test('frecency decides between equally good matches', () => {
    assertEquals(rank('fi')[0], 'Firefox', 'shorter title wins the tie');
    const frecency = new Frecency();
    for (let i = 0; i < 4; i++)
        frecency.record('apps:org.gnome.Nautilus.desktop', NOW);
    assertEquals(rank('fi', frecency)[0], 'Fichiers');
});

test('nothing matches a query unrelated to every app', () => {
    assertEquals(rank('zzzq'), []);
});

test('results carry what the window and the ranking need', () => {
    const firefox = RESULTS.find(r => r.id === 'org.mozilla.firefox.desktop');
    assertEquals(firefox.title, 'Firefox');
    assertEquals(firefox.subtitle, 'Navigateur Web');
    assertEquals(firefox.frecencyKey, 'apps:org.mozilla.firefox.desktop');
    assertEquals(firefox.matchFields[0], {text: 'Firefox', weight: 1, folded: 'firefox'});
    assert(firefox.matchFields.every(f => f.folded === f.folded.toLowerCase()), 'folded fields are lower case');
});

test('the subtitle falls back to the description, first line only', () => {
    const [result] = buildAppResults([{id: 'a.desktop', name: 'A', description: 'First line\nSecond line'}]);
    assertEquals(result.subtitle, 'First line');
    assertEquals(buildAppResults([{id: 'b.desktop', name: 'B'}])[0].subtitle, '');
});

test('apps without an id or a name are skipped, and a duplicate id is kept once', () => {
    const results = buildAppResults([
        {id: '', name: 'No id'}, {id: 'x.desktop', name: ''}, null,
        {id: 'ok.desktop', name: 'First'}, {id: 'ok.desktop', name: 'Second'},
    ]);
    assertEquals(results.map(r => r.title), ['First']);
});

test('empty keywords are ignored and the id is a last, low-weight field', () => {
    const [result] = buildAppResults([{id: 'org.x.App.desktop', name: 'App', keywords: ['', 'k']}]);
    assertEquals(result.matchFields.map(f => f.text), ['App', 'k', 'org.x.App']);
    assertEquals(result.matchFields[2].weight, 0.4);
});

test('pickByIds keeps the order of the ids and skips unknown ones', () => {
    const picked = pickByIds(RESULTS, ['org.gnome.clocks.desktop', 'missing', 'org.mozilla.firefox.desktop']);
    assertEquals(picked.map(r => r.title), ['Horloges', 'Firefox']);
});

test('ranking a few hundred apps takes a few milliseconds', () => {
    const many = [];
    for (let i = 0; i < 300; i++)
        many.push({id: `org.example.App${i}.desktop`, name: `Example Application ${i}`, genericName: 'Tool', keywords: ['alpha', 'beta', 'gamma']});
    const results = buildAppResults(many);
    const matcher = createMatcher('exap');
    const start = Date.now();
    for (let round = 0; round < 20; round++) {
        for (const result of results)
            scoreResult(result, matcher, null, NOW);
    }
    const perQueryMs = (Date.now() - start) / 20;
    // The budget is 16 ms for a whole keystroke; a generous bound still catches an accident.
    assert(perQueryMs < 8, `scoring 300 apps took ${perQueryMs} ms`);
});
