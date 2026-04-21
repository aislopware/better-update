import { Args, Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { exitWith } from "../../application/command-exit";
import { runFingerprintFull } from "../../lib/fingerprint";
import { CliRuntime } from "../../services/cli-runtime";

const hash = Args.text({ name: "hash" });

export const compareCommand = Command.make("compare", { hash }, (opts) =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const projectRoot = yield* runtime.cwd;
    const result = yield* runFingerprintFull(projectRoot);

    if (result.hash === opts.hash) {
      yield* Console.log("Fingerprints match.");
      return undefined;
    }
    yield* Console.log("Fingerprints differ.");
    yield* Console.log(`  Local:    ${result.hash}`);
    yield* Console.log(`  Provided: ${opts.hash}`);
    return yield* exitWith(1, "Fingerprint mismatch");
  }).pipe(Effect.catchTag("FingerprintError", (error) => exitWith(2, error.message))),
);
