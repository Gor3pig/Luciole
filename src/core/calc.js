// SPDX-FileCopyrightText: 2026 Luciole contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// What the search field says when it holds a calculation or a conversion: "(12,5 + 7,5) * 3 - 4",
// "20 % de 150", "5 km en miles". The text is read by a small parser of our own and never run:
// there is no eval, no Function, and every limit below keeps the work bounded whatever is typed.
//
// Numbers take a comma or a point as the decimal mark, and spaces inside a number are ignored
// ("1 000" is 1000), so no text is ever read differently depending on a language.

import {convert, findUnit} from './units.js';

export const MAX_INPUT = 200;
export const MAX_TOKENS = 100;
export const MAX_DEPTH = 16;
// A result shows this many significant digits: enough for the units defined exactly (an ounce is
// 28.349523125 g), few enough to hide the noise of floating point (0.1 + 0.2 = 0.30000000000000004).
const SIGNIFICANT_DIGITS = 12;

const FUNCTIONS = new Map([
    ['sqrt', Math.sqrt], ['racine', Math.sqrt],
    ['abs', Math.abs],
    ['round', Math.round], ['arrondi', Math.round],
    ['floor', Math.floor], ['ceil', Math.ceil],
    ['sin', Math.sin], ['cos', Math.cos], ['tan', Math.tan],
    ['ln', Math.log], ['log', Math.log10], ['exp', Math.exp],
]);
const CONSTANTS = new Map([['pi', Math.PI], ['π', Math.PI], ['e', Math.E]]);
// What separates a conversion ("5 km en m"). "in" is also the inch: every one of these words is
// tried in turn, and only one with a unit before it and a unit after it separates ("10 in in cm").
const TO_WORDS = new Set(['en', 'vers', 'to', 'in']);

const SPACES = /[\s\u00a0\u202f]/u;
const LETTER = /[\p{L}°µ]/u;
const DIGIT = /[0-9]/;
const DATE_LIKE = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/;

// ---- Reading the text into tokens ----

/**
 * @returns {Array<{type: string, value?: any}> | null} null when the text holds something that is
 * not part of a calculation, or is too long
 */
function tokenize(text) {
    const tokens = [];
    let i = 0;
    while (i < text.length) {
        if (tokens.length >= MAX_TOKENS)
            return null;
        const c = text[i];
        if (SPACES.test(c)) {
            i++;
        } else if (DIGIT.test(c) || ((c === '.' || c === ',') && DIGIT.test(text[i + 1] ?? ''))) {
            const read = readNumber(text, i);
            tokens.push({type: 'number', value: read.value});
            i = read.end;
        } else if (LETTER.test(c)) {
            let j = i;
            while (j < text.length && LETTER.test(text[j]))
                j++;
            tokens.push({type: 'word', value: text.slice(i, j)});
            i = j;
        } else if (c === '-' && text[i + 1] === '>') {
            tokens.push({type: 'word', value: 'to'});
            i += 2;
        } else if (c === '=' && text[i + 1] === '>') {
            tokens.push({type: 'word', value: 'to'});
            i += 2;
        } else if (c === '→') {
            tokens.push({type: 'word', value: 'to'});
            i++;
        } else if ('+-−×*·/÷^%()'.includes(c)) {
            tokens.push({type: 'op', value: {'−': '-', '×': '*', '·': '*', '÷': '/'}[c] ?? c});
            i++;
        } else {
            return null;
        }
    }
    return tokens;
}

// A number: digits, then possibly a decimal mark and digits; groups of three digits after a space
// belong to it ("1 000 000"). Returns its value and where it ends.
function readNumber(text, start) {
    let i = start;
    let digits = '';
    const takeDigits = () => {
        while (i < text.length && DIGIT.test(text[i]))
            digits += text[i++];
    };
    takeDigits();
    while (SPACES.test(text[i] ?? '') && /^[\s\u00a0\u202f][0-9]{3}(?![0-9])/u.test(text.slice(i, i + 5)) && !/[.,]/.test(text.slice(start, i))) {
        i++;
        takeDigits();
    }
    if ((text[i] === '.' || text[i] === ',') && DIGIT.test(text[i + 1] ?? '')) {
        digits += '.';
        i++;
        takeDigits();
    }
    return {value: Number(digits.startsWith('.') ? `0${digits}` : digits), end: i};
}

// ---- Evaluating tokens ----

class Stop extends Error {}

// A recursive-descent reader over the tokens. Every method returns {v, pct}: the value, and whether
// it is a bare percentage ("20 %"), which "150 + 20 %" reads as 20 % of 150.
class Reader {
    constructor(tokens) {
        this.tokens = tokens;
        this.pos = 0;
        this.depth = 0;
        // Binary operations, functions and percentages seen: a lone number is not a calculation.
        this.work = 0;
    }

    get peek() {
        return this.tokens[this.pos];
    }

    isOp(value) {
        return this.peek?.type === 'op' && this.peek.value === value;
    }

    isWord(...values) {
        return this.peek?.type === 'word' && values.includes(this.peek.value.toLowerCase());
    }

    expression() {
        let left = this.term();
        for (;;) {
            if (this.isOp('+') || this.isOp('-')) {
                const sign = this.peek.value === '+' ? 1 : -1;
                this.pos++;
                this.work++;
                const right = this.term();
                // "150 + 20 %" is 150 plus 20 % of 150.
                const amount = right.pct ? left.v * right.v : right.v;
                let sum = left.v + sign * amount;
                // Two nearly equal numbers cancel (3 * 1.1 - 3.3): what is left of them is the noise
                // of floating point, not a value.
                if (Math.abs(sum) < Math.max(Math.abs(left.v), Math.abs(amount)) * 1e-14)
                    sum = 0;
                left = {v: sum, pct: false};
            } else {
                return left;
            }
        }
    }

    term() {
        let left = this.unary();
        for (;;) {
            if (this.isOp('*') || this.isOp('/') || this.isWord('mod')) {
                const op = this.isWord('mod') ? 'mod' : this.peek.value;
                this.pos++;
                this.work++;
                const right = this.unary();
                if (op === '*') {
                    left = {v: left.v * right.v, pct: false};
                } else {
                    if (right.v === 0)
                        throw new Stop();
                    left = {v: op === '/' ? left.v / right.v : left.v % right.v, pct: false};
                }
            } else {
                return left;
            }
        }
    }

    unary() {
        if (this.isOp('-') || this.isOp('+')) {
            const sign = this.peek.value === '-' ? -1 : 1;
            this.pos++;
            this.enter();
            const inner = this.unary();
            this.depth--;
            return {v: sign * inner.v, pct: false};
        }
        return this.power();
    }

    power() {
        const base = this.atom();
        if (this.isOp('^')) {
            this.pos++;
            this.work++;
            this.enter();
            const exponent = this.unary();
            this.depth--;
            return {v: base.v ** exponent.v, pct: false};
        }
        return base;
    }

    atom() {
        const token = this.peek;
        if (!token)
            throw new Stop();
        if (token.type === 'number') {
            this.pos++;
            if (!this.isOp('%'))
                return {v: token.value, pct: false};
            this.pos++;
            this.work++;
            // "20 % de 150" (or "of"): that share of what follows.
            if (this.isWord('de', 'of')) {
                this.pos++;
                this.enter();
                const whole = this.unary();
                this.depth--;
                return {v: token.value / 100 * whole.v, pct: false};
            }
            return {v: token.value / 100, pct: true};
        }
        if (token.type === 'op' && token.value === '(') {
            this.pos++;
            this.enter();
            const inner = this.expression();
            this.depth--;
            if (!this.isOp(')'))
                throw new Stop();
            this.pos++;
            return {v: inner.v, pct: false};
        }
        if (token.type === 'word') {
            const name = token.value.toLowerCase();
            const fn = FUNCTIONS.get(name);
            const next = this.tokens[this.pos + 1];
            if (fn && next?.type === 'op' && next.value === '(') {
                this.pos += 2;
                this.work++;
                this.enter();
                const inner = this.expression();
                this.depth--;
                if (!this.isOp(')'))
                    throw new Stop();
                this.pos++;
                return {v: fn(inner.v), pct: false};
            }
            if (CONSTANTS.has(name)) {
                this.pos++;
                return {v: CONSTANTS.get(name), pct: false};
            }
        }
        throw new Stop();
    }

    enter() {
        if (++this.depth > MAX_DEPTH)
            throw new Stop();
    }
}

// Reads `tokens` as one expression, optionally followed by one trailing word (a unit).
// Returns {value, unit, work, pct} or null.
function readExpression(tokens, {allowUnit}) {
    if (tokens.length === 0)
        return null;
    const reader = new Reader(tokens);
    let result;
    try {
        result = reader.expression();
    } catch (error) {
        if (error instanceof Stop)
            return null;
        throw error;
    }
    let unit = null;
    if (reader.pos < tokens.length) {
        const rest = tokens.slice(reader.pos);
        if (!allowUnit || rest.length !== 1 || rest[0].type !== 'word')
            return null;
        unit = rest[0].value;
    }
    return {value: result.v, unit, work: reader.work, pct: result.pct};
}

// ---- Showing numbers ----

/**
 * A number as it is shown and copied: at most 10 significant digits, no grouping, the given
 * decimal mark. null when it is not a finite number.
 *
 * @param {number} value
 * @param {string} [decimal] - "." or ","
 * @returns {string | null}
 */
export function formatNumber(value, decimal = '.') {
    if (!Number.isFinite(value))
        return null;
    const rounded = Number(value.toPrecision(SIGNIFICANT_DIGITS));
    const text = rounded === 0 ? '0' : String(rounded);
    return decimal === ',' ? text.replace('.', ',') : text;
}

// ---- The entry point ----

/**
 * Reads a search text as a calculation or a conversion.
 *
 * @param {string} text
 * @param {{decimal?: string, symbol?: (symbol: string) => string}} [options] - the decimal mark to
 *   show results with, and how a unit's symbol is shown (translated)
 * @returns {{kind: 'calc' | 'convert', text: string, result: string, full: string} | null}
 *   null when the text is not clearly one, or cannot be worked out
 */
export function evaluateQuery(text, {decimal = '.', symbol = shownAs => shownAs} = {}) {
    if (typeof text !== 'string')
        return null;
    const query = text.trim();
    if (query === '' || query.length > MAX_INPUT || DATE_LIKE.test(query))
        return null;
    const tokens = tokenize(query);
    if (!tokens || tokens.length < 2)
        return null;
    const shown = query.replace(/\s+/gu, ' ');

    // A conversion: "<expression> <unit> en <unit>". Every "en"/"vers"/"to" is tried as the
    // separator, since "To" (terabyte) is also one.
    for (let i = 1; i < tokens.length - 1; i++) {
        const token = tokens[i];
        if (token.type !== 'word' || !TO_WORDS.has(token.value.toLowerCase()))
            continue;
        const left = readExpression(tokens.slice(0, i), {allowUnit: true});
        const right = tokens.slice(i + 1);
        if (!left || left.unit === null || right.length !== 1 || right[0].type !== 'word')
            continue;
        const from = findUnit(left.unit);
        const to = findUnit(right[0].value);
        const value = convert(left.value, from, to);
        const input = formatNumber(left.value, decimal);
        const output = formatNumber(value, decimal);
        if (value === null || input === null || output === null)
            continue;
        return {
            kind: 'convert',
            text: shown,
            result: `${output} ${symbol(to.symbol)}`,
            full: `${input} ${symbol(from.symbol)} = ${output} ${symbol(to.symbol)}`,
        };
    }

    const read = readExpression(tokens, {allowUnit: false});
    // A lone percentage ("20 %") is not a calculation either.
    if (!read || read.work === 0 || read.pct)
        return null;
    const result = formatNumber(read.value, decimal);
    if (result === null)
        return null;
    return {kind: 'calc', text: shown, result, full: `${shown} = ${result}`};
}
