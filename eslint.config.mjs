// eslint.config.js — flat-config ESLint focused on catching missing imports.
// Runs as part of `npm run check:imports` in CI and locally.

import globals from "globals";

export default [
  {
    files: ["js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        supabase: "readonly",   // UMD global published by the CDN script in index.html
        twemoji: "readonly",    // UMD global from the twemoji CDN script
      },
    },
    rules: {
      // The rule that would have caught both "btn is not defined" and
      // "e is not defined" on day one. no-undef is scope-aware — it knows
      // a function parameter named `e` is only bound inside that function,
      // so a `e` usage at module top level still fires the rule.
      "no-undef": "error",
      "no-unused-vars": "off",
    },
  },
  {
    files: ["sw.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.serviceworker },
    },
    rules: { "no-undef": "error" },
  },
];
