// @ts-check
const tseslint = require("@typescript-eslint/eslint-plugin");
const tsparser = require("@typescript-eslint/parser");

const sharedRules = {
  ...tseslint.configs.recommended.rules,
  "@typescript-eslint/no-unused-vars": "error",
  "no-console": "warn",
};

module.exports = [
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.eslint.json",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: sharedRules,
  },
  {
    // A separate project: renderer/tsconfig.json targets the browser (DOM
    // lib, ES module output) instead of src/test's Node/CommonJS project —
    // sharing one tsconfig.eslint.json project across both isn't possible
    // without one set of compiler options fighting the other.
    files: ["renderer/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./renderer/tsconfig.json",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: sharedRules,
  },
  {
    ignores: ["dist/**", "node_modules/**", "test-results/**", "playwright-report/**"],
  },
];
