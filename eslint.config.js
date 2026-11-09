import js from "@eslint/js";

// Mods run inside Herdr's own JS runtime (gpui-shell), not Node or a browser, so no env globals are
// assumed. Anything a mod uses must be an import from "gpui-kit", "gpui-base" or "herdr", or an ES2022
// built-in. The generated .d.ts files and jsconfig.json are not linted.
export default [
  { ignores: ["node_modules/**", "**/*.d.ts"] },
  js.configs.recommended,
  {
    files: ["git-panel/mods/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
      // `x != null` is deliberate: lane slots and optional values may be null or undefined.
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-var": "error",
    },
  },
];
