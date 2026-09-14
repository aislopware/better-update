import { compact } from "@better-update/type-guards";
import { Effect, Option } from "effect";

import type { FileSystem } from "effect";

import { CliRuntime } from "../services/cli-runtime";
import { BETTER_UPDATE_PROJECT_ID_ENV, readEasLinkedProjectId } from "./eas-json";
import { ProjectNotLinkedError } from "./exit-codes";
import {
  extractProjectId,
  getConfigFilePaths,
  isExpoConfigInstalled,
  PROJECT_NOT_LINKED_MESSAGE,
  readAppMeta,
  readExpoConfig,
} from "./expo-config";

import type { AppMeta, Platform } from "./build-profile";
import type { ExpoConfig } from "./expo-config";

/**
 * Resolve the active better-update project id, build-system-agnostically.
 *
 * Precedence: `BETTER_UPDATE_PROJECT_ID` env > `eas.json` top-level `projectId`
 * > `@expo/config` (`extra.betterUpdate.projectId`). The Expo branch is taken
 * only when `@expo/config` is installed, so a non-Expo project (no app.json,
 * Expo not installed) never crashes at module load — it simply falls through to
 * the `ProjectNotLinkedError`. Every `env`/`credentials`/`status` command
 * reaches the vault through this single resolver.
 */
export const readProjectId: Effect.Effect<
  string,
  ProjectNotLinkedError,
  CliRuntime | FileSystem.FileSystem
> = Effect.gen(function* () {
  const runtime = yield* CliRuntime;

  const fromEnv = yield* runtime.getEnv(BETTER_UPDATE_PROJECT_ID_ENV);
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }

  const projectRoot = yield* runtime.cwd;

  const fromConfig = yield* readEasLinkedProjectId(projectRoot);
  if (fromConfig !== undefined) {
    return fromConfig;
  }

  // Expo fallback — only when @expo/config is installed (so the require reached
  // inside readExpoConfig can't throw at the module boundary) AND the project
  // actually has an app.json / app.config.* to read. A config that exists but
  // fails to evaluate (a config plugin that does not resolve, a throwing
  // app.config.ts) is surfaced as-is: hiding it behind the generic "not
  // linked" message sent users chasing their projectId instead of the real
  // error. Only a config with no `extra.betterUpdate.projectId` falls through.
  if (isExpoConfigInstalled() && (yield* hasExpoConfigFile(projectRoot))) {
    const config = yield* readExpoConfig(projectRoot);
    const fromExpo = yield* extractProjectId(config).pipe(Effect.option);
    if (Option.isSome(fromExpo)) {
      return fromExpo.value;
    }
  }

  return yield* new ProjectNotLinkedError({ message: PROJECT_NOT_LINKED_MESSAGE });
});

/** Whether `@expo/config` would find a static or dynamic config in `projectRoot`. */
const hasExpoConfigFile = (projectRoot: string): Effect.Effect<boolean> =>
  getConfigFilePaths(projectRoot).pipe(
    Effect.map((paths) => paths.staticConfigPath !== null || paths.dynamicConfigPath !== null),
    Effect.orElseSucceed(() => false),
  );

/**
 * Spreadable `{ projectId }` fragment for credential CREATE payloads: the
 * linked project id when the CLI runs inside a linked project (so the server
 * auto-binds the new credential — or its Apple team — to that project,
 * GITLAB-RBAC-SPEC §1a), empty otherwise. Never fails and never prompts, so
 * it changes no command's flag surface.
 */
export const autoBindProjectId: Effect.Effect<
  { readonly projectId?: string },
  never,
  CliRuntime | FileSystem.FileSystem
> = readProjectId.pipe(
  Effect.orElseSucceed(() => undefined),
  Effect.map((projectId) => compact({ projectId })),
);

/**
 * Read the Expo config without failing: `Option.some(config)` when an Expo
 * project is present and loads, otherwise `Option.none()` (no `@expo/config`
 * installed, no config file, or a config that errors). Lets `init` decide
 * whether to write the link into the Expo config vs `eas.json`.
 */
export const readExpoConfigOptional = (
  projectRoot: string,
): Effect.Effect<Option.Option<ExpoConfig>> =>
  Effect.suspend(() => {
    if (!isExpoConfigInstalled()) {
      return Effect.succeed(Option.none<ExpoConfig>());
    }
    return readExpoConfig(projectRoot).pipe(
      Effect.map(Option.some),
      Effect.orElseSucceed(() => Option.none<ExpoConfig>()),
      Effect.catchDefect(() => Effect.succeed(Option.none<ExpoConfig>())),
    );
  });

/** AppMeta with every field cleared — the result when no Expo config is present. */
export const EMPTY_APP_META: AppMeta = {
  bundleId: undefined,
  androidPackage: undefined,
  appVersion: undefined,
  buildNumber: undefined,
  rawRuntimeVersion: undefined,
};

/**
 * Best-effort {@link AppMeta} for a platform: reads the Expo config + section
 * when an Expo project is present, otherwise returns {@link EMPTY_APP_META}.
 * Never fails (and never dies when `@expo/config` is not installed), so vault
 * commands can use app.json identifiers as a *default* while still working on a
 * non-Expo project where the caller falls back to a flag or a prompt.
 */
export const readAppMetaOptional = (
  projectRoot: string,
  platform: Platform,
): Effect.Effect<AppMeta> =>
  Effect.suspend(() => {
    if (!isExpoConfigInstalled()) {
      return Effect.succeed(EMPTY_APP_META);
    }
    return readExpoConfig(projectRoot).pipe(
      Effect.flatMap((config) => readAppMeta(config, platform)),
      Effect.orElseSucceed(() => EMPTY_APP_META),
      Effect.catchDefect(() => Effect.succeed(EMPTY_APP_META)),
    );
  });
