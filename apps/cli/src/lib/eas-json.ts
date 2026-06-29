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
 * Set `submit.<profileName>.ios.ascApiKeyId` in `eas.json`, preserving every
 * other submit profile and key. Used after auto-resolving/creating an ASC API
 * key during `submit` so the next run reuses it instead of creating another.
 */
export const setSubmitProfileAscApiKeyId = (
  projectRoot: string,
  profileName: string,
  ascApiKeyId: string,
): Effect.Effect<string, ProjectNotLinkedError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const existing = (yield* readEasJsonRaw(projectRoot)) ?? {};
    const submit = isRecord(existing["submit"]) ? existing["submit"] : {};
    const profile = isRecord(submit[profileName]) ? submit[profileName] : {};
    const ios = isRecord(profile["ios"]) ? profile["ios"] : {};
    const nextSubmit = {
      ...submit,
      [profileName]: { ...profile, ios: { ...ios, ascApiKeyId } },
    };
    return yield* writeEasJsonPatch(projectRoot, { submit: nextSubmit });
  });

/**
 * Default `build` profiles scaffolded by `init` / `build configure`. Mirrors the
 * EAS three-tier convention: `development` (dev-client, internal), `preview`
 * (internal QA) and `production` (store). Keep in sync with the build-profile
 * derivation in `build-profile.ts` (e.g. `distribution: "internal"` → ad-hoc).
 */
export const DEFAULT_BUILD_PROFILES = {
  development: {
    developmentClient: true,
    distribution: "internal",
    channel: "development",
    environment: "development",
    android: { format: "apk" },
  },
  preview: {
    distribution: "internal",
    channel: "preview",
    environment: "preview",
    android: { format: "apk" },
  },
  production: {
    channel: "production",
    environment: "production",
    android: { format: "aab" },
  },
} as const;

export const DEFAULT_PROFILE_NAMES = ["development", "preview", "production"] as const;

/** Full default `eas.json` body (cli pin + the three default build profiles). */
export const DEFAULT_EAS_JSON = {
  cli: { version: ">= 7.0.0" },
  build: DEFAULT_BUILD_PROFILES,
} as const;

export interface ScaffoldEasJsonResult {
  readonly path: string;
  readonly action: "created" | "topped-up" | "noop";
  /** Profile names written this run (`[]` for a noop). */
  readonly added: readonly string[];
}

/**
 * Ensure `eas.json` carries the default build profiles. Creates the file with
 * the full default template when absent; otherwise tops up only the missing
 * default profiles, preserving every existing profile and top-level key
 * (`projectId`, `projectType`, `submit`, …). Never overwrites a profile that is
 * already defined — call sites wanting a hard reset write `DEFAULT_EAS_JSON`.
 */
export const ensureDefaultBuildProfiles = (
  projectRoot: string,
): Effect.Effect<ScaffoldEasJsonResult, ProjectNotLinkedError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const existing = yield* readEasJsonRaw(projectRoot);
    if (existing === undefined) {
      const filePath = yield* writeEasJsonPatch(projectRoot, DEFAULT_EAS_JSON);
      return { path: filePath, action: "created", added: [...DEFAULT_PROFILE_NAMES] };
    }
    const existingBuild = isRecord(existing["build"]) ? existing["build"] : {};
    const missing = DEFAULT_PROFILE_NAMES.filter((name) => !(name in existingBuild));
    if (missing.length === 0) {
      return { path: easJsonPath(projectRoot), action: "noop", added: [] };
    }
    const additions = Object.fromEntries(
      missing.map((name) => [name, DEFAULT_BUILD_PROFILES[name]]),
    );
    const patch =
      existing["cli"] === undefined
        ? { cli: DEFAULT_EAS_JSON.cli, build: { ...existingBuild, ...additions } }
        : { build: { ...existingBuild, ...additions } };
    const filePath = yield* writeEasJsonPatch(projectRoot, patch);
    return { path: filePath, action: "topped-up", added: missing };
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
