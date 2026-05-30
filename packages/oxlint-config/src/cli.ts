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

    // By-construction prompt gating: lib/prompts.ts is the SOLE @clack/prompts
    // importer so every prompt funnels through ensureInteractive() and is
    // gated by InteractiveMode. Any other importer would bypass non-interactive
    // gating and could hang a `--non-interactive` / `--json` run. The exemption
    // for lib/prompts.ts is in the override below.
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@clack/prompts",
            message:
              "Import prompt helpers from lib/prompts.ts instead. It is the only allowed @clack/prompts importer so every prompt is gated by InteractiveMode (non-interactive runs fail fast instead of hanging).",
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ["**/lib/prompts.ts"],
      rules: {
        "no-restricted-imports": "off",
      },
    },
  ],
});
