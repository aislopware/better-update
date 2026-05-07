import { Effect } from "effect";

import type { CommandExecutor } from "@effect/platform";

import { RuntimeVersionError } from "./exit-codes";
import { runFingerprintFull } from "./fingerprint";

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

    const { policy } = raw;
    if (policy === "appVersion") {
      if (appVersion === undefined) {
        return yield* new RuntimeVersionError({
          message: 'runtimeVersion policy is "appVersion" but expo.version is missing in app.json.',
        });
      }
      return appVersion;
    }

    if (policy === "fingerprint") {
      return yield* runFingerprintFull(projectRoot).pipe(
        Effect.map((result) => result.hash),
        Effect.mapError((cause) => new RuntimeVersionError({ message: cause.message })),
      );
    }

    if (policy === "nativeVersion") {
      return yield* new RuntimeVersionError({
        message:
          'runtimeVersion policy "nativeVersion" is not supported. Set a static runtimeVersion string in your Expo config.',
      });
    }

    return yield* new RuntimeVersionError({
      message: `Unsupported runtimeVersion policy "${policy}". Use a static string, "appVersion", or "fingerprint".`,
    });
  });
