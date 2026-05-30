import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { runFingerprintForPlatform, runFingerprintFull } from "../../lib/fingerprint";
import { printHuman } from "../../lib/output";
import { CliRuntime } from "../../services/cli-runtime";

export const generateCommand = defineCommand({
  meta: { name: "generate", description: "Compute a fingerprint for the current project" },
  args: {
    platform: {
      type: "string",
      description:
        "Compute the fingerprint for a single platform (ios|android), matching the per-platform hash on builds/updates",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const runtime = yield* CliRuntime;
        const projectRoot = yield* runtime.cwd;
        const platform =
          args.platform === "ios" || args.platform === "android" ? args.platform : undefined;
        const result =
          platform === undefined
            ? yield* runFingerprintFull(projectRoot)
            : yield* runFingerprintForPlatform(projectRoot, platform);
        yield* printHuman(result.hash);
        if (result.sources.length > 0) {
          yield* printHuman(`${result.sources.length} sources`);
        }
        return result;
      }),
      { exits: { FingerprintError: 2 }, json: "value" },
    ),
});
