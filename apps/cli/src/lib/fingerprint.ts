import { isRecord } from "@better-update/type-guards";
import { Command } from "@effect/platform";
import { Data, Effect } from "effect";

import type { CommandExecutor } from "@effect/platform";

export class FingerprintError extends Data.TaggedError("FingerprintError")<{
  readonly message: string;
}> {}

export interface FingerprintSource {
  readonly type: string;
  readonly filePath?: string;
  readonly reasons: readonly string[];
  readonly hash: string | null;
}

export interface FingerprintResult {
  readonly hash: string;
  readonly sources: readonly FingerprintSource[];
}

export const runFingerprintFull = (
  projectRoot: string,
): Effect.Effect<FingerprintResult, FingerprintError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const cmd = Command.make("bunx", "@expo/fingerprint", projectRoot).pipe(
      Command.workingDirectory(projectRoot),
    );
    const stdout = yield* Command.string(cmd).pipe(
      Effect.mapError(
        (cause) =>
          new FingerprintError({
            message: `Failed to run "@expo/fingerprint": ${cause.message}`,
          }),
      ),
    );

    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(stdout),
      catch: () =>
        new FingerprintError({
          message: "Failed to parse @expo/fingerprint output as JSON.",
        }),
    });

    if (!isRecord(parsed)) {
      return yield* new FingerprintError({
        message: "@expo/fingerprint output was not a JSON object.",
      });
    }

    const { hash } = parsed;
    if (typeof hash !== "string" || hash.length === 0) {
      return yield* new FingerprintError({
        message: '@expo/fingerprint output did not contain a "hash" string field.',
      });
    }

    const sourcesRaw = parsed["sources"];
    const sources: readonly FingerprintSource[] = Array.isArray(sourcesRaw)
      ? (sourcesRaw as readonly FingerprintSource[])
      : [];

    return { hash, sources };
  });
