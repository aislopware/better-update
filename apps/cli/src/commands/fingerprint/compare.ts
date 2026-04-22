import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { exitWith } from "../../application/command-exit";
import { runEffect } from "../../lib/citty-effect";
import { runFingerprintFull } from "../../lib/fingerprint";
import { CliRuntime } from "../../services/cli-runtime";

export const compareCommand = defineCommand({
  meta: { name: "compare", description: "Compare a fingerprint hash against the current project" },
  args: {
    hash: { type: "positional", required: true, description: "Fingerprint hash to compare" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const runtime = yield* CliRuntime;
        const projectRoot = yield* runtime.cwd;
        const result = yield* runFingerprintFull(projectRoot);

        if (result.hash === args.hash) {
          yield* Console.log("Fingerprints match.");
          return undefined;
        }
        yield* Console.log("Fingerprints differ.");
        yield* Console.log(`  Local:    ${result.hash}`);
        yield* Console.log(`  Provided: ${args.hash}`);
        return yield* exitWith(1, "Fingerprint mismatch");
      }),
      { FingerprintError: 2 },
    ),
});
