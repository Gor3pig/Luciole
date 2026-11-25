import js from '@eslint/js';

// Globals provided by GJS and GNOME Shell (there is no browser or Node here).
const gjsGlobals = {
    console: 'readonly',
    global: 'readonly',
    log: 'readonly',
    logError: 'readonly',
    print: 'readonly',
    printerr: 'readonly',
    imports: 'readonly',
    ARGV: 'readonly',
    TextDecoder: 'readonly',
    TextEncoder: 'readonly',
};

const shellOnly = [
    'gi://Shell',
    'gi://St',
    'gi://Clutter',
    'gi://Meta',
    'gi://Mtk',
    'resource:///org/gnome/shell/*',
];
const gtkOnly = ['gi://Gtk', 'gi://Gdk', 'gi://Adw'];

export default [
    {ignores: ['node_modules/', 'dist/']},
    js.configs.recommended,
    {
        files: ['src/**/*.js', 'tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: gjsGlobals,
        },
        rules: {
            'no-var': 'error',
            'prefer-const': 'error',
            'eqeqeq': ['error', 'always'],
            'no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
            'no-shadow': 'error',
        },
    },
    {
        // The core is pure logic: it must run under plain gjs, outside the shell.
        files: ['src/core/**/*.js'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [{
                    group: [...shellOnly, ...gtkOnly],
                    message: 'src/core must not depend on GNOME Shell or GTK.',
                }],
            }],
        },
    },
    {
        // Extension code runs inside the shell process: no GTK there.
        files: ['src/**/*.js'],
        ignores: ['src/core/**', 'src/prefs.js', 'src/prefs/**'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [{
                    group: gtkOnly,
                    message: 'GTK, GDK and Adwaita must not be imported in the shell process.',
                }],
            }],
        },
    },
    {
        // Preferences run in a separate process: no shell internals there.
        files: ['src/prefs.js', 'src/prefs/**/*.js'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [{
                    group: shellOnly,
                    message: 'Preferences must not import GNOME Shell modules.',
                }],
            }],
        },
    },
];
