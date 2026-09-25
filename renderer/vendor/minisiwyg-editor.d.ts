// Types for the editor's own ES module, which scripts/copy-ui-assets.mjs
// copies to dist/ui/vendor/minisiwyg-editor.js. The renderer has no
// bundler, so it imports that copied file by relative path; this file
// lets TypeScript type-check that import against the package's types.
export * from "../../node_modules/minisiwyg-editor/dist/index.js";
