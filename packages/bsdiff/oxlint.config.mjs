import base from "@better-update/oxlint-config/base";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [base],
  // napi build emits index.js / index.d.ts (auto-generated loader + types) and
  // the native binary into the package root; never lint generated output.
  // conformance/ is a standalone Node ESM ship-gate harness (+ vendored C);
  // it is run via `node`, not part of the typed src, so it stays out of lint.
  ignorePatterns: ["index.js", "index.d.ts", "*.node", "target", "npm", "conformance"],
});
