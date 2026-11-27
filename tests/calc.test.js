// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

import {evaluateQuery, formatNumber, MAX_DEPTH, MAX_INPUT, MAX_TOKENS} from '../src/core/calc.js';
import {convert, findUnit} from '../src/core/units.js';
import {assert, assertEquals, test} from './harness.js';

const calc = (text, decimal = '.') => evaluateQuery(text, {decimal})?.result ?? null;

test('the four operations, with the usual priorities and parentheses', () => {
    assertEquals(calc('2+2*3'), '8');
    assertEquals(calc('(2+2)*3'), '12');
    assertEquals(calc('10 - 4 - 3'), '3', 'subtraction goes left to right');
    assertEquals(calc('100 / 5 / 2'), '10', 'division goes left to right');
    assertEquals(calc('2*3+4*5'), '26');
    assertEquals(calc('(12,5 + 7,5) × 3 − 4'), '56');
});

test('power is right to left and binds tighter than a minus sign', () => {
    assertEquals(calc('2^3^2'), '512');
    assertEquals(calc('-2^2'), '-4');
    assertEquals(calc('(-2)^2'), '4');
    assertEquals(calc('2^-1'), '0.5');
});

test('the signs and symbols people actually type', () => {
    assertEquals(calc('6 ÷ 3'), '2');
    assertEquals(calc('6 / 3'), '2');
    assertEquals(calc('2 × 3'), '6');
    assertEquals(calc('2 · 3'), '6');
    assertEquals(calc('5 − 2'), '3', 'the typographic minus');
    assertEquals(calc('7 mod 3'), '1');
    assertEquals(calc('7 MOD 3'), '1');
    assertEquals(calc('3 + -2'), '1');
    assertEquals(calc('3 - -2'), '5');
});

test('a comma or a point is the decimal mark, and spaces inside a number are ignored', () => {
    assertEquals(calc('1,5 + 1'), '2.5');
    assertEquals(calc('1.5 + 1'), '2.5');
    assertEquals(calc('.5 + 1'), '1.5');
    assertEquals(calc(',5 + 1'), '1.5');
    assertEquals(calc('1 000 + 1'), '1001');
    assertEquals(calc('1 000 000 + 1'), '1000001');
    assertEquals(calc(`1${String.fromCodePoint(0x202f)}000 + 1`), '1001', 'a narrow no-break space');
    assertEquals(calc('1,000 + 1'), '2', '1,000 is one, never a thousand');
    assertEquals(calc('1 0000 + 1'), null, 'four digits after a space are another number, not a group');
});

test('the result is shown with the decimal mark asked for, rounded to ten digits', () => {
    assertEquals(calc('1/4', ','), '0,25');
    assertEquals(calc('1/4', '.'), '0.25');
    assertEquals(calc('0.1 + 0.2'), '0.3');
    assertEquals(calc('1/3'), '0.3333333333');
    assertEquals(calc('2/3'), '0.6666666667');
    assertEquals(calc('1000000 * 1000000'), '1000000000000');
});

test('very large and very small results use an exponent, and keep the decimal mark', () => {
    assertEquals(calc('10^25'), '1e+25');
    assertEquals(calc('10^25 / 4', ','), '2,5e+24');
    assertEquals(calc('1/10^9'), '1e-9');
});

test('percentages: a share of, an addition and a subtraction', () => {
    assertEquals(calc('20 % de 150'), '30');
    assertEquals(calc('20% of 150'), '30');
    assertEquals(calc('150 + 20 %'), '180');
    assertEquals(calc('150 - 20 %'), '120');
    assertEquals(calc('150 + 20% + 10%'), '198');
    assertEquals(calc('50 % * 2'), '1');
    assertEquals(calc('10 % de (100 + 100)'), '20');
});

test('functions and constants', () => {
    assertEquals(calc('sqrt(16) + 1'), '5');
    assertEquals(calc('racine(81) * 2'), '18');
    assertEquals(calc('abs(-3) + 0'), '3');
    assertEquals(calc('round(2.6) + 0'), '3');
    assertEquals(calc('floor(2.6) + 0'), '2');
    assertEquals(calc('ceil(2.1) + 0'), '3');
    assertEquals(calc('ln(e)'), '1');
    assertEquals(calc('log(1000)'), '3');
    assertEquals(calc('exp(0)'), '1');
    assertEquals(calc('sin(0) + cos(0)'), '1');
    assertEquals(calc('pi * 2'), '6.283185307');
    assertEquals(calc('π * 2'), '6.283185307');
    assertEquals(calc('Pi * 2'), '6.283185307');
    assertEquals(calc('sqrt(sqrt(16))'), '2');
});

test('what is not clearly a calculation gives nothing', () => {
    for (const text of ['sqrt 1 + 2) * 1', 'abs -3) + 0', '', '   ', '2026', '-5', '(5)', 'pi', 'e', '2 pi', 'firefox', 'firefox 2', 'rapport 2026', '20 %', '20%', '2 + ', '+ 2', '* 3', '(1 + 2', '1 + 2)', '1 2', '5 km', 'abc + 1', '3 +* 4', '2026-11-26', '26/11/2026', '1/2/3', '10-4-3', '100/5/2', '06 12 34 56 78', '192.168.1.1'])
        assertEquals(calc(text), null, JSON.stringify(text));
});

test('anything that cannot be worked out gives nothing, never an error', () => {
    for (const text of ['1/0', '5 mod 0', 'sqrt(-1)', 'ln(0) + 0', '0^-1', '10^1000', '9^9^9^9', 'log(-1) + 1', '(-8)^0.5'])
        assertEquals(calc(text), null, text);
});

test('characters that are not part of a calculation give nothing', () => {
    for (const text of ['1 + 2; rm -rf', '1 + "2"', '1 + $x', '1 + {2}', '`1+1`', '1 + 2 // comment', '1,2,3 + 1', '1 + 2 = 3', 'alert(1) + 1', '1 + 2\n'.replace('\n', '\u0007')])
        assertEquals(calc(text), null, JSON.stringify(text));
});

test('nothing is ever run: the names of JavaScript things are just unknown words', () => {
    for (const text of ['constructor(1) + 1', 'toString(2) + 1', '__proto__ + 1', 'this + 1', 'globalThis + 1', 'eval(1+1)', 'Function(1) + 1', 'import(1) + 1'])
        assertEquals(calc(text), null, text);
});

test('the text may be long enough, but not too long, nor made of too many pieces', () => {
    assert(evaluateQuery(`1${' + 1'.repeat(30)}`) !== null, 'a long sum is fine');
    assertEquals(evaluateQuery(`1${' + 1'.repeat(MAX_INPUT)}`), null, 'more than the longest text');
    assertEquals(evaluateQuery(`1${' '.repeat(MAX_INPUT)}+1`), null, 'a long text of few pieces');
    assertEquals(evaluateQuery(`1${'+1'.repeat(MAX_TOKENS / 2 + 10)}`), null, 'more than the most pieces, in a short text');
    assertEquals(evaluateQuery(`1${'+1'.repeat(MAX_TOKENS / 2 - 1)}`)?.result, String(MAX_TOKENS / 2), 'just under the limits');
});

test('parentheses and signs can only be nested so deep', () => {
    const nested = depth => `${'('.repeat(depth)}1+1${')'.repeat(depth)}`;
    assertEquals(evaluateQuery(nested(MAX_DEPTH - 1))?.result, '2');
    assertEquals(evaluateQuery(nested(MAX_DEPTH + 1)), null);
    assertEquals(evaluateQuery(`${'-'.repeat(MAX_DEPTH + 2)}1+1`), null);
    assertEquals(evaluateQuery(`1${'^1'.repeat(MAX_DEPTH + 2)}`), null);
    assertEquals(evaluateQuery(`${'sqrt('.repeat(MAX_DEPTH + 2)}1${')'.repeat(MAX_DEPTH + 2)}+1`), null);
});

test('what is not text gives nothing', () => {
    for (const odd of [undefined, null, 5, {}, ['1+1']])
        assertEquals(evaluateQuery(odd), null, String(odd));
});

test('the answer carries the text as typed, the result and the whole calculation', () => {
    assertEquals(evaluateQuery('  2 +   2 ', {decimal: ','}), {kind: 'calc', text: '2 + 2', result: '4', full: '2 + 2 = 4'});
});

test('a conversion: the same kind of unit, French or English names, several ways to say "to"', () => {
    assertEquals(evaluateQuery('5 km en miles', {decimal: ','}), {kind: 'convert', text: '5 km en miles', result: '3,106855961 mi', full: '5 km = 3,106855961 mi'});
    for (const text of ['5 km to mi', '5 km vers mi', '5km en mi', '5 KM EN MI', '5 km -> mi', '5 km => mi', '5 km → mi', '5 kilomètres en miles'])
        assertEquals(evaluateQuery(text)?.result, '3.106855961 mi', text);
});

test('conversions take an expression on the left', () => {
    assertEquals(evaluateQuery('(2 + 3) km en m')?.result, '5000 m');
    assertEquals(evaluateQuery('2 * 2,5 kg en g')?.result, '5000 g');
});

test('the usual conversions give the usual numbers', () => {
    const results = {
        '1 mile en km': '1.609344 km', '1 in en cm': '2.54 cm', '10 ft en m': '3.048 m', '3 yd en m': '2.7432 m',
        '1 kg en lb': '2.204622622 lb', '1 oz en g': '28.34952313 g', '2 tonnes en kg': '2000 kg',
        '1 gallon en l': '3.785411784 l', '1 cup en ml': '236.5882365 ml', '2 l en cl': '200 cl',
        '2 h en min': '120 min', '1 jour en h': '24 h', '1 semaine en jours': '7 j', '90 s en min': '1.5 min',
        '0 °C en °F': '32 °F', '100 °C en K': '373.15 K', '32 °F en °C': '0 °C', '212 °F en °C': '100 °C', '0 K en °C': '-273.15 °C',
        '1 Go en Mo': '1000 MB', '1 Gio en Mio': '1024 MiB', '1 Kio en o': '1024 B', '1 Tio en Gio': '1024 GiB', '1 Ko en o': '1000 B', '2 To en Go': '2000 GB', '1 GB to MB': '1000 MB',
        '20 °C en °F': '68 °F', '20°C en °F': '68 °F',
    };
    for (const [text, expected] of Object.entries(results))
        assertEquals(evaluateQuery(text)?.result, expected, text);
});

test('"To" is both a unit and a word for "to"', () => {
    assertEquals(evaluateQuery('2 To to Go')?.result, '2000 GB');
    assertEquals(evaluateQuery('2 To en Go')?.result, '2000 GB');
    assertEquals(evaluateQuery('2000 Go to To')?.result, '2 TB');
});

test('units of different kinds, unknown units and a missing unit give nothing', () => {
    for (const text of ['5 km en kg', '5 kg en l', '5 °C en m', '5 foo en m', '5 m en foo', '5 en m', '5 km en', 'km en m', '5 km en m en cm', '5 m en m m'])
        assertEquals(evaluateQuery(text), null, text);
});

test('a conversion that cannot be worked out gives nothing', () => {
    assertEquals(evaluateQuery('1/0 km en m'), null);
    assertEquals(evaluateQuery('10^305 km en mm'), null, 'a result too big to be finite');
});

test('a number is shown with ten significant digits, no grouping, and zero is just zero', () => {
    assertEquals(formatNumber(1234567.891), '1234567.891');
    assertEquals(formatNumber(1 / 3), '0.3333333333');
    assertEquals(formatNumber(0), '0');
    assertEquals(formatNumber(-0), '0');
    assertEquals(formatNumber(1.5, ','), '1,5');
    assertEquals(formatNumber(NaN), null);
    assertEquals(formatNumber(Infinity), null);
    assertEquals(formatNumber(-Infinity), null);
});

test('units are found by any of their names, in any case and with accents, with an optional plural s', () => {
    assertEquals(findUnit('Kilomètres').symbol, 'km');
    assertEquals(findUnit('KM').symbol, 'km');
    assertEquals(findUnit('miles').symbol, 'mi');
    assertEquals(findUnit('heures').symbol, 'h');
    assertEquals(findUnit('°C').symbol, '°C');
    assertEquals(findUnit('celsius').symbol, '°C');
    for (const odd of ['', 'foo', 'x'.repeat(30), undefined, null, 5, 's s', 'ss'])
        assertEquals(findUnit(odd), null, String(odd));
});

test('only units of the same kind convert, and a result that is not a number is refused', () => {
    assertEquals(convert(1, findUnit('km'), findUnit('m')), 1000);
    assertEquals(convert(1, findUnit('km'), findUnit('kg')), null);
    assertEquals(convert(1, null, findUnit('m')), null);
    assertEquals(convert(1, findUnit('m'), null), null);
    assertEquals(convert(NaN, findUnit('m'), findUnit('km')), null);
    assertEquals(convert(Infinity, findUnit('m'), findUnit('km')), null);
    assert(convert(1e308, findUnit('t'), findUnit('mg')) === null, 'a result too big to be finite');
    assert(convert(1e308, findUnit('t'), findUnit('t')) === null, 'an intermediate value too big to be finite');
});

test('the symbol of a unit is shown the way the caller writes it (translated)', () => {
    const french = {MB: 'Mo', GB: 'Go'};
    const shown = evaluateQuery('1 GB to MB', {symbol: name => french[name] ?? name});
    assertEquals(shown.result, '1000 Mo');
    assertEquals(shown.full, '1 Go = 1000 Mo');
    assertEquals(evaluateQuery('5 km en m', {symbol: name => french[name] ?? name}).result, '5000 m', 'others unchanged');
});
