import { isRecord } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { easJsonPath, readEasJson, resolveEasSubmitProfile } from "./eas-config";
import { ProjectNotLinkedError } from "./exit-codes";
import { formatCause } from "./format-error";

import type { EasSubmitProfile } from "./eas-config";
import type { BuildProfileError } from "./exit-codes";

/**
 * `eas.json` is better-update's single project config file — for every build
 * system, not just Expo. Besides the EAS-shaped `cli`/`build`/`submit`
 * sections it carries two CLI-owned top-level extension keys:
 *
 * - `projectId`   — the better-update project link (non-Expo projects; Expo
 *                   projects may keep it in app.json `extra.betterUpdate`).
 * - `projectType` — build-system override ("expo" | "bare" | "kmp" | "native"
 *                   | "custom") for projects auto-detection gets wrong.
 *
 * Helpers here read/write the file as a raw record so unknown keys (and the
 * extension keys) survive round-trips untouched.
 */

/**
 * Environment variable that overrides project-id resolution. Highest precedence
 * so CI and ephemeral checkouts can target a project without writing any file.
 */
export const BETTER_UPDATE_PROJECT_ID_ENV = "BETTER_UPDATE_PROJECT_ID";

/**
 * Read `eas.json` as a raw record if present. Returns `undefined` when the
 * file is missing or holds invalid JSON — an unlinked project is a normal
 * state, not an error (profile readers surface parse errors separately).
 */
export const readEasJsonRaw = (
  projectRoot: string,
): Effect.Effect<Record<string, unknown> | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const content = yield* fs
      .readFileString(easJsonPath(projectRoot))
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
 * Merge `patch` into the existing `eas.json` (creating it if absent) and write
 * it back, returning the absolute file path. Shallow merge: patched keys win,
 * all other keys are preserved verbatim.
 */
export const writeEasJsonPatch = (
  projectRoot: string,
  patch: Record<string, unknown>,
): Effect.Effect<string, ProjectNotLinkedError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const filePath = easJsonPath(projectRoot);
    const existing = yield* readEasJsonRaw(projectRoot);
    const merged = { ...existing, ...patch };
    yield* fs.writeFileString(filePath, `${JSON.stringify(merged, null, 2)}\n`).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectNotLinkedError({
            message: `Failed to write eas.json: ${formatCause(cause)}`,
          }),
      ),
    );
    return filePath;
  });

/**
 * Resolve the linked project id from `eas.json`'s top-level `projectId`, or
 * `undefined` when the file is absent / has no usable value.
 */
export const readEasLinkedProjectId = (
  projectRoot: string,
): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  readEasJsonRaw(projectRoot).pipe(
    Effect.map((config) => {
      const id = config?.["projectId"];
      return typeof id === "string" && id.length > 0 ? id : undefined;
    }),
  );

/**
 * Raw `projectType` override from `eas.json`, for `detectProjectType`.
 * Callers narrow it via `asProjectType`.
 */
export const readEasProjectType = (
  projectRoot: string,
): Effect.Effect<unknown, never, FileSystem.FileSystem> =>
  readEasJsonRaw(projectRoot).pipe(Effect.map((config) => config?.["projectType"]));

/** List available build-profile names; `[]` when no eas.json exists. */
export const listBuildProfileNames = (
  projectRoot: string,
): Effect.Effect<readonly string[], BuildProfileError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const hasEas = yield* fs
      .exists(easJsonPath(projectRoot))
      .pipe(Effect.orElseSucceed(() => false));
    if (!hasEas) {
      return [];
    }
    const config = yield* readEasJson(projectRoot);
    return Object.keys(config.build ?? {});
  });

/** Resolve a submit profile from `eas.json`'s `submit` section. */
export const readSubmitProfile = (
  projectRoot: string,
  profileName: string,
): Effect.Effect<EasSubmitProfile, BuildProfileError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const config = yield* readEasJson(projectRoot);
    return yield* resolveEasSubmitProfile(config.submit, profileName, "eas.json");
  });
