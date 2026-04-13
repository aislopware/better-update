import { Command, CommandExecutor } from "@effect/platform";
import { Effect } from "effect";

import { RuntimeVersionError } from "./exit-codes";

import type { RawRuntimeVersion } from "./build-profile";

export interface ResolveRuntimeVersionOptions {
  readonly raw: RawRuntimeVersion | undefined;
  readonly appVersion: string | undefined;
  readonly projectRoot: string;
}

export const resolveRuntimeVersion = ({
  raw,
  appVersion,
  projectRoot,
}: ResolveRuntimeVersionOptions): Effect.Effect<
  string,
  RuntimeVersionError,
  CommandExecutor.CommandExecutor
> =>
  Effect.gen(function* () {
    if (typeof raw === "string") {
      return raw;
    }
    if (raw === undefined) {
      return yield* new RuntimeVersionError({
        message: "No runtimeVersion configured in expo section of app.json.",
      });
    }

    const policy = raw.policy;
    if (policy === "appVersion") {
      if (appVersion === undefined) {
        return yield* new RuntimeVersionError({
          message: 'runtimeVersion policy is "appVersion" but expo.version is missing in app.json.',
        });
      }
      return appVersion;
    }

    if (policy === "fingerprint") {
      return yield* runFingerprint(projectRoot);
    }

    if (policy === "nativeVersion") {
      return yield* new RuntimeVersionError({
        message:
          'runtimeVersion policy "nativeVersion" is not supported. Set a static runtimeVersion string in app.json.',
      });
    }

    return yield* new RuntimeVersionError({
      message: `Unsupported runtimeVersion policy "${policy}". Use a static string, "appVersion", or "fingerprint".`,
    });
  });

const runFingerprint = (
  projectRoot: string,
): Effect.Effect<string, RuntimeVersionError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const cmd = Command.make("npx", "@expo/fingerprint", projectRoot);
    const stdout = yield* Command.string(cmd).pipe(
      Effect.mapError(
        (cause) =>
          new RuntimeVersionError({
            message: `Failed to run "@expo/fingerprint": ${cause.message}`,
          }),
      ),
    );

    const parsed = yield* Effect.try({
      try: () => JSON.parse(stdout) as { readonly hash?: unknown },
      catch: () =>
        new RuntimeVersionError({
          message: "Failed to parse @expo/fingerprint output as JSON.",
        }),
    });

    const hash = parsed.hash;
    if (typeof hash !== "string" || hash.length === 0) {
      return yield* new RuntimeVersionError({
        message: '@expo/fingerprint output did not contain a "hash" string field.',
      });
    }
    return hash;
  });
