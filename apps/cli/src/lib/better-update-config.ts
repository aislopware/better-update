import path from "node:path";

import { isRecord } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { ProjectNotLinkedError } from "./exit-codes";
import { formatCause } from "./format-error";

/**
 * Environment variable that overrides project-id resolution. Highest precedence
 * so CI and ephemeral checkouts can target a project without writing any file.
 */
export const BETTER_UPDATE_PROJECT_ID_ENV = "BETTER_UPDATE_PROJECT_ID";

/**
 * Build-system-neutral project link file. Lives at the project root and lets a
 * non-Expo project (KMP, Flutter, native, …) carry a better-update project id
 * without an `app.json` / `@expo/config`.
 */
export const BETTER_UPDATE_CONFIG_FILENAME = "better-update.json";

const configPath = (projectRoot: string): string =>
  path.join(projectRoot, BETTER_UPDATE_CONFIG_FILENAME);

/**
 * Read the project-local `better-update.json` if present. Returns `undefined`
 * when the file is missing or holds invalid JSON — an unlinked project is a
 * normal state, not an error. Mirrors {@link file://./../services/config-store.ts}'s
 * graceful `readConfig`.
 */
export const readBetterUpdateConfig = (
  projectRoot: string,
): Effect.Effect<Record<string, unknown> | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const content = yield* fs
      .readFileString(configPath(projectRoot))
      .pipe(Effect.orElseSucceed(() => ""));
    if (content.length === 0) {
      return undefined;
    }
    return yield* Effect.try((): unknown => JSON.parse(content)).pipe(
      Effect.map((parsed) => (isRecord(parsed) ? parsed : undefined)),
      Effect.orElseSucceed(() => undefined),
    );
  });

/**
 * Resolve the linked project id from `better-update.json`, or `undefined` when
 * the file is absent / has no usable `projectId`.
 */
export const readLinkedProjectId = (
  projectRoot: string,
): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  readBetterUpdateConfig(projectRoot).pipe(
    Effect.map((config) => {
      const id = config?.["projectId"];
      return typeof id === "string" && id.length > 0 ? id : undefined;
    }),
  );

/**
 * Merge `patch` into the existing `better-update.json` (creating it if absent)
 * and write it back, returning the absolute file path. Used by `init` to persist
 * a project link for build-system-neutral projects.
 */
export const writeBetterUpdateConfig = (
  projectRoot: string,
  patch: Record<string, unknown>,
): Effect.Effect<string, ProjectNotLinkedError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const filePath = configPath(projectRoot);
    const existing = yield* readBetterUpdateConfig(projectRoot);
    const merged = { ...existing, ...patch };
    yield* fs.writeFileString(filePath, `${JSON.stringify(merged, null, 2)}\n`).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectNotLinkedError({
            message: `Failed to write ${BETTER_UPDATE_CONFIG_FILENAME}: ${formatCause(cause)}`,
          }),
      ),
    );
    return filePath;
  });
