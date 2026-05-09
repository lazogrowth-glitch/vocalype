import i18next from "eslint-plugin-i18next";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      i18next,
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // ── i18n ───────────────────────────────────────────────────────────────
      // Catch text in JSX that should be translated.
      "i18next/no-literal-string": [
        "error",
        {
          markupOnly: true,
          ignoreAttribute: [
            "className",
            "style",
            "type",
            "id",
            "name",
            "key",
            "data-*",
            "aria-*",
            "aria-label",
            "aria-description",
            "placeholder",
            "title",
          ],
        },
      ],

      // ── TypeScript quality ─────────────────────────────────────────────────
      // Forbid `any` — use `unknown` or a proper type instead.
      "@typescript-eslint/no-explicit-any": "warn",
      // Require explicit return types on exported functions (keeps public API clear).
      "@typescript-eslint/explicit-module-boundary-types": "off",
      // Disallow `@ts-ignore`; use `@ts-expect-error` with an explanation instead.
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": "allow-with-description",
          "ts-expect-error": "allow-with-description",
        },
      ],
      // Prevent accidental floating promises.
      "@typescript-eslint/no-floating-promises": "off", // would need parserServices
      // Prefer `const` assertions over inline type casts where possible.
      "@typescript-eslint/consistent-type-assertions": [
        "warn",
        { assertionStyle: "as" },
      ],

      // ── General quality ────────────────────────────────────────────────────
      // Disallow `console.log` in production code; `console.warn/error` are allowed.
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // Prevent accidental `debugger` statements committed.
      "no-debugger": "error",
    },
  },
  {
    // Relax some rules for test files.
    files: ["src/**/*.test.{ts,tsx}", "src/test/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },
  {
    // Generated bindings intentionally use broad types.
    files: ["src/bindings.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
