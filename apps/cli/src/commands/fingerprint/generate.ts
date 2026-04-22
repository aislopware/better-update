import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { runFingerprintFull } from "../../lib/fingerprint";
import { CliRuntime } from "../../services/cli-runtime";

export const generateCommand = defineCommand({
  meta: { name: "generate", description: "Compute a fingerprint for the current project" },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const runtime = yield* CliRuntime;
        const projectRoot = yield* runtime.cwd;
        const result = yield* runFingerprintFull(projectRoot);
        yield* Console.log(result.hash);
        if (result.sources.length > 0) {
          yield* Console.log(`${result.sources.length} sources`);
        }
      }),
      { FingerprintError: 2 },
    ),
});
