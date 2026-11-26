// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Units of measure and conversions between them. A unit is known by several names, in French and
// in English, found after the text is lower-cased and stripped of accents. Only units of the same
// kind convert to one another; there are no currencies (they need the network).

import {fold} from './text.js';

/**
 * Each unit: its symbol (shown), its names, and how it relates to the base unit of its kind
 * (`factor` multiplies a value in the unit to give the base; `offset` is added first, for
 * temperatures, whose base is the kelvin).
 */
const UNITS = [
    // Length, base: metre.
    {kind: 'length', symbol: 'mm', names: ['mm', 'millimetre', 'millimeter'], factor: 0.001},
    {kind: 'length', symbol: 'cm', names: ['cm', 'centimetre', 'centimeter'], factor: 0.01},
    {kind: 'length', symbol: 'm', names: ['m', 'metre', 'meter'], factor: 1},
    {kind: 'length', symbol: 'km', names: ['km', 'kilometre', 'kilometer'], factor: 1000},
    {kind: 'length', symbol: 'in', names: ['in', 'inch', 'inches', 'pouce'], factor: 0.0254},
    {kind: 'length', symbol: 'ft', names: ['ft', 'foot', 'feet', 'pied'], factor: 0.3048},
    {kind: 'length', symbol: 'yd', names: ['yd', 'yard'], factor: 0.9144},
    {kind: 'length', symbol: 'mi', names: ['mi', 'mile', 'mille'], factor: 1609.344},
    // Mass, base: gram.
    {kind: 'mass', symbol: 'mg', names: ['mg', 'milligramme', 'milligram'], factor: 0.001},
    {kind: 'mass', symbol: 'g', names: ['g', 'gramme', 'gram'], factor: 1},
    {kind: 'mass', symbol: 'kg', names: ['kg', 'kilogramme', 'kilogram', 'kilo'], factor: 1000},
    {kind: 'mass', symbol: 't', names: ['t', 'tonne'], factor: 1_000_000},
    {kind: 'mass', symbol: 'oz', names: ['oz', 'once', 'ounce'], factor: 28.349523125},
    {kind: 'mass', symbol: 'lb', names: ['lb', 'lbs', 'livre', 'pound'], factor: 453.59237},
    // Volume, base: litre (the American cup, pint and gallon).
    {kind: 'volume', symbol: 'ml', names: ['ml', 'millilitre', 'milliliter'], factor: 0.001},
    {kind: 'volume', symbol: 'cl', names: ['cl', 'centilitre', 'centiliter'], factor: 0.01},
    {kind: 'volume', symbol: 'l', names: ['l', 'litre', 'liter'], factor: 1},
    {kind: 'volume', symbol: 'cup', names: ['cup', 'tasse'], factor: 0.2365882365},
    {kind: 'volume', symbol: 'pt', names: ['pt', 'pinte', 'pint'], factor: 0.473176473},
    {kind: 'volume', symbol: 'gal', names: ['gal', 'gallon'], factor: 3.785411784},
    // Time, base: second.
    {kind: 'time', symbol: 'ms', names: ['ms', 'milliseconde', 'millisecond'], factor: 0.001},
    {kind: 'time', symbol: 's', names: ['s', 'sec', 'seconde', 'second'], factor: 1},
    {kind: 'time', symbol: 'min', names: ['min', 'minute'], factor: 60},
    {kind: 'time', symbol: 'h', names: ['h', 'hr', 'heure', 'hour'], factor: 3600},
    {kind: 'time', symbol: 'j', names: ['j', 'd', 'jour', 'day'], factor: 86400},
    {kind: 'time', symbol: 'sem', names: ['sem', 'semaine', 'week'], factor: 604800},
    // Temperature, base: kelvin.
    {kind: 'temperature', symbol: '°C', names: ['°c', 'c', 'celsius', '°celsius'], factor: 1, offset: 273.15},
    {kind: 'temperature', symbol: '°F', names: ['°f', 'f', 'fahrenheit', '°fahrenheit'], factor: 5 / 9, offset: 459.67},
    {kind: 'temperature', symbol: 'K', names: ['k', 'kelvin'], factor: 1, offset: 0},
    // Computing, base: byte (octet). Kilo, mega... are 1000 times, kibi, mebi... 1024 times.
    {kind: 'data', symbol: 'o', names: ['o', 'octet', 'byte'], factor: 1},
    {kind: 'data', symbol: 'Ko', names: ['ko', 'kb'], factor: 1e3},
    {kind: 'data', symbol: 'Mo', names: ['mo', 'mb'], factor: 1e6},
    {kind: 'data', symbol: 'Go', names: ['go', 'gb'], factor: 1e9},
    {kind: 'data', symbol: 'To', names: ['to', 'tb'], factor: 1e12},
    {kind: 'data', symbol: 'Kio', names: ['kio', 'kib'], factor: 1024},
    {kind: 'data', symbol: 'Mio', names: ['mio', 'mib'], factor: 1024 ** 2},
    {kind: 'data', symbol: 'Gio', names: ['gio', 'gib'], factor: 1024 ** 3},
    {kind: 'data', symbol: 'Tio', names: ['tio', 'tib'], factor: 1024 ** 4},
];

const BY_NAME = new Map();
for (const unit of UNITS) {
    unit.offset ??= 0;
    for (const name of unit.names)
        BY_NAME.set(name, unit);
}

// The longest a unit name can be: anything longer is not one, and need not be looked up.
const MAX_NAME_LENGTH = 24;

/**
 * The unit a name stands for ("Km", "kilomètres", "°C"), or null. A plural "s" is allowed.
 *
 * @param {string} name
 * @returns {{kind: string, symbol: string, factor: number, offset: number} | null}
 */
export function findUnit(name) {
    if (typeof name !== 'string' || name === '' || name.length > MAX_NAME_LENGTH)
        return null;
    const folded = fold(name);
    const exact = BY_NAME.get(folded);
    if (exact)
        return exact;
    // "kilometres", "miles", "heures": one plural "s" (or "x" for none we know) is not part of the name.
    if (folded.length > 2 && folded.endsWith('s'))
        return BY_NAME.get(folded.slice(0, -1)) ?? null;
    return null;
}

/**
 * Converts a value from one unit to another of the same kind.
 *
 * @param {number} value
 * @param {object} from - a unit from findUnit()
 * @param {object} to
 * @returns {number | null} null when the units are of different kinds or the result is not finite
 */
export function convert(value, from, to) {
    if (!from || !to || from.kind !== to.kind || !Number.isFinite(value))
        return null;
    const base = (value + from.offset) * from.factor;
    let result = base / to.factor - to.offset;
    if (!Number.isFinite(result))
        return null;
    // Converting temperatures subtracts two nearly equal numbers (32 °F is 273.15 K, and so is
    // 0 °C): what is left of that cancellation is noise, not a value.
    if (Math.abs(result) < Math.max(Math.abs(base / to.factor), Math.abs(to.offset)) * 1e-12)
        result = 0;
    return result;
}
