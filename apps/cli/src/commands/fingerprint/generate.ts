import { Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { exitWith } from "../../application/command-exit";
import { runFingerprintFull } from "../../lib/fingerprint";
import { CliRuntime } from "../../services/cli-runtime";

export const generateCommand = Command.make("generate", {}, () =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const projectRoot = yield* runtime.cwd;
    const result = yield* runFingerprintFull(projectRoot);
    yield* Console.log(result.hash);
    if (result.sources.length > 0) {
      yield* Console.log(`${result.sources.length} sources`);
    }
  }).pipe(Effect.catchTag("FingerprintError", (error) => exitWith(2, error.message))),
);
