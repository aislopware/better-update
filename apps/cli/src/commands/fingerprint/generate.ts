import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { runFingerprintForPlatform, runFingerprintFull } from "../../lib/fingerprint";
import { printHuman } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";
import { CliRuntime } from "../../services/cli-runtime";

export const generateCommand = Command.make(
  "generate",
  {
    platform: Flag.Literals("platform", ["ios", "android"]).pipe(
      Flag.withDescription(
        "Compute the fingerprint for a single platform, matching the per-platform hash on builds/updates",
      ),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const runtime = yield* CliRuntime;
      const projectRoot = yield* runtime.cwd;
      const { platform } = args;
      const result =
        platform === undefined
          ? yield* runFingerprintFull(projectRoot)
          : yield* runFingerprintForPlatform(projectRoot, platform);
      yield* printHuman(result.hash);
      if (result.sources.length > 0) {
        yield* printHuman(`${result.sources.length} sources`);
      }
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Compute a fingerprint for the current project"));
