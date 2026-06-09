import base from "@better-update/oxlint-config/base";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [base],
  ignorePatterns: ["**/*.d.ts", "coverage", "vitest.config.*", "tests", "scripts"],
});
