import { Command, CommandExecutor } from "@effect/platform";
import { Data, Effect } from "effect";

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
      try: () => JSON.parse(stdout) as { readonly hash?: unknown; readonly sources?: unknown },
      catch: () =>
        new FingerprintError({
          message: "Failed to parse @expo/fingerprint output as JSON.",
        }),
    });

    const hash = parsed.hash;
    if (typeof hash !== "string" || hash.length === 0) {
      return yield* new FingerprintError({
        message: '@expo/fingerprint output did not contain a "hash" string field.',
      });
    }

    // eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- @expo/fingerprint output shape is stable; sources only used for display (count)
    const sources: readonly FingerprintSource[] = Array.isArray(parsed.sources)
      ? (parsed.sources as readonly FingerprintSource[])
      : [];

    return { hash, sources };
  });
