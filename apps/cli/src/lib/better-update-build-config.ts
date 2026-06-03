import { Effect } from "effect";

import type { FileSystem } from "@effect/platform";

import { readBetterUpdateConfig } from "./better-update-config";
import { parseConfigFromRecord, resolveEasSubmitProfile } from "./eas-config";

import type { EasConfig, EasSubmitProfile } from "./eas-config";
import type { BuildProfileError } from "./exit-codes";

/** Label used in profile-resolution error copy when config comes from this file. */
export const BETTER_UPDATE_SOURCE_LABEL = "better-update.json";

/**
 * Read the `build`/`submit`/`cli` config from `better-update.json`. Returns an
 * empty config (no `build` key) when the file is absent or carries no build
 * section. Shares the parser with {@link file://./eas-config.ts}; only the
 * source file and the error `sourceLabel` differ.
 */
export const readBuildConfig = (
  projectRoot: string,
): Effect.Effect<EasConfig, never, FileSystem.FileSystem> =>
  readBetterUpdateConfig(projectRoot).pipe(
    Effect.map((config) => (config === undefined ? {} : parseConfigFromRecord(config))),
  );

/** List available build-profile names declared in `better-update.json`. */
export const listBuildProfileNames = (
  projectRoot: string,
): Effect.Effect<readonly string[], never, FileSystem.FileSystem> =>
  readBuildConfig(projectRoot).pipe(Effect.map((config) => Object.keys(config.build ?? {})));

/** Resolve a submit profile from `better-update.json`'s `submit` section. */
export const readSubmitProfile = (
  projectRoot: string,
  profileName: string,
): Effect.Effect<EasSubmitProfile, BuildProfileError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const config = yield* readBuildConfig(projectRoot);
    return yield* resolveEasSubmitProfile(config.submit, profileName, BETTER_UPDATE_SOURCE_LABEL);
  });
