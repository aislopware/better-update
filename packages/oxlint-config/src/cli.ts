import { defineConfig } from "oxlint";

import base from "./base.ts";

export default defineConfig({
  extends: [base],
  rules: {
    "import/no-nodejs-modules": "off",

    "functional/no-let": "off",
    "functional/no-loop-statements": "off",
    "functional/no-try-statements": "off",

    "no-await-in-loop": "off",

    "node/no-process-env": "off",
    "node/global-require": "off",
    "unicorn/prefer-module": "off",
    "typescript/no-var-requires": "off",
    "typescript/no-require-imports": "off",
  },
});
