import nodePath from "node:path";

import { isRecord } from "@better-update/type-guards";
import { Command, FileSystem } from "@effect/platform";
import { Data, Effect } from "effect";

import type { CommandExecutor } from "@effect/platform";

import type { Platform } from "./build-profile";

export class FingerprintError extends Data.TaggedError("FingerprintError")<{
  readonly message: string;
}> {}

/**
 * Expo workflow for a platform. Mirrors `expo-updates`'
 * `resolveWorkflowAsync`: a project is `generic` (bare) when the platform's
 * native marker file exists (`ios/*.xcodeproj` or `android/app/build.gradle`),
 * otherwise `managed` (prebuild-on-demand). This drives the fingerprint
 * `ignorePaths` so a managed project's fingerprint is identical whether or not
 * it has been prebuilt.
 */
export type Workflow = "managed" | "generic";

export interface FingerprintSource {
  readonly type: string;
  /** Present on `file`/`dir` sources — the project-relative path. */
  readonly filePath?: string;
  /** Present on `contents` sources — the stable content-group id (e.g. `expoConfig`). */
  readonly id?: string;
  /** Optional hash-key override for `file`/`dir` sources (takes precedence over `filePath`). */
  readonly overrideHashKey?: string;
  readonly reasons: readonly string[];
  readonly hash: string | null;
}

export interface FingerprintResult {
  readonly hash: string;
  readonly sources: readonly FingerprintSource[];
}

export type FingerprintDiffOp = "added" | "removed" | "modified";

export interface FingerprintDiffItem {
  readonly op: FingerprintDiffOp;
  readonly sourceId: string;
  readonly type: string;
  readonly reasons: readonly string[];
  readonly hashBefore?: string | null;
  readonly hashAfter?: string | null;
}

/**
 * Stable identity for a fingerprint source. `@expo/fingerprint` keys
 * `file`/`dir` sources by `filePath` (or `overrideHashKey` when set) and
 * `contents` sources by `id`. The key is namespaced by source kind so a file
 * path can never collide with a contents id that happens to share the string;
 * the human-facing {@link FingerprintDiffItem.sourceId} is the un-namespaced
 * value.
 */
const sourceId = (source: FingerprintSource): string =>
  source.type === "contents"
    ? (source.id ?? source.type)
    : (source.overrideHashKey ?? source.filePath ?? source.id ?? source.type);

const sourceKey = (source: FingerprintSource): string => {
  const kind = source.type === "dir" ? "file" : source.type;
  return `${kind}:${sourceId(source)}`;
};

/**
 * Pure, order-independent set-diff over two parsed fingerprint source arrays,
 * keyed by {@link sourceKey}. Reproduces `@expo/fingerprint`'s source-level
 * categorisation without depending on the package:
 *
 * - `added`: present only in `b`.
 * - `removed`: present only in `a`.
 * - `modified`: present in both with a differing `hash` (carries
 *   `hashBefore`/`hashAfter`).
 *
 * Unchanged sources (same key, same hash) are omitted. The returned items are
 * sorted by `sourceId` so output is deterministic regardless of input order.
 */
export const diffFingerprintSources = (
  before: readonly FingerprintSource[],
  after: readonly FingerprintSource[],
): readonly FingerprintDiffItem[] => {
  const beforeByKey = new Map(before.map((source) => [sourceKey(source), source] as const));
  const afterByKey = new Map(after.map((source) => [sourceKey(source), source] as const));

  const items: FingerprintDiffItem[] = [];

  for (const [key, beforeSource] of beforeByKey) {
    const afterSource = afterByKey.get(key);
    if (afterSource === undefined) {
      items.push({
        op: "removed",
        sourceId: sourceId(beforeSource),
        type: beforeSource.type,
        reasons: beforeSource.reasons,
        hashBefore: beforeSource.hash,
      });
    } else if (afterSource.hash !== beforeSource.hash) {
      items.push({
        op: "modified",
        sourceId: sourceId(afterSource),
        type: afterSource.type,
        reasons: afterSource.reasons,
        hashBefore: beforeSource.hash,
        hashAfter: afterSource.hash,
      });
    }
  }

  for (const [key, afterSource] of afterByKey) {
    if (!beforeByKey.has(key)) {
      items.push({
        op: "added",
        sourceId: sourceId(afterSource),
        type: afterSource.type,
        reasons: afterSource.reasons,
        hashAfter: afterSource.hash,
      });
    }
  }

  return items.toSorted((left, right) => left.sourceId.localeCompare(right.sourceId));
};

/**
 * Detect the Expo workflow for `platform` by probing for the platform's native
 * marker file, mirroring `expo-updates`' `resolveWorkflowAsync`:
 *
 * - android: `android/app/build.gradle`
 * - ios: an `ios/<name>.xcodeproj` directory (probed via the `ios/` dir, since
 *   the project name is not known up front)
 *
 * Present marker → `generic` (bare); absent → `managed`. Any I/O error degrades
 * to `managed`, the safe default for a CLI that defaults to prebuild-on-demand.
 */
export const resolveExpoWorkflow = (
  projectRoot: string,
  platform: Platform,
): Effect.Effect<Workflow, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (platform === "android") {
      const gradlePath = nodePath.join(projectRoot, "android", "app", "build.gradle");
      const exists = yield* fs.exists(gradlePath).pipe(Effect.orElseSucceed(() => false));
      return exists ? "generic" : "managed";
    }
    // iOS: a bare project has an `ios/<name>.xcodeproj`. The project name is not
    // known here, so treat a non-empty `ios/` directory containing an
    // `.xcodeproj` as the generic marker.
    const iosDir = nodePath.join(projectRoot, "ios");
    const entries = yield* fs.readDirectory(iosDir).pipe(Effect.orElseSucceed(() => []));
    const hasXcodeproj = entries.some((entry) => entry.endsWith(".xcodeproj"));
    return hasXcodeproj ? "generic" : "managed";
  });

export interface RunFingerprintOptions {
  /**
   * Restrict the fingerprint to a single platform, mirroring EAS
   * (`createFingerprintAsync` always passes `platforms: [platform]`). When
   * omitted, `@expo/fingerprint` hashes BOTH platforms — which diverges from the
   * per-platform device RTV, so callers resolving a `fingerprint`-policy RTV
   * MUST pass this.
   */
  readonly platform?: Platform;
  /**
   * Workflow for the platform. In the `managed` workflow EAS ignores the native
   * directories (`android/**`, `ios/**`) so the fingerprint is identical whether
   * or not the project has been prebuilt. Ignored when `platform` is omitted.
   */
  readonly workflow?: Workflow;
}

const MANAGED_FINGERPRINT_IGNORE_PATHS: readonly string[] = ["android/**/*", "ios/**/*"];

/**
 * Build the `@expo/fingerprint` CLI args, threading EAS's per-platform +
 * managed-workflow options through the legacy CLI flags (`--platform`,
 * `--ignore-path`). A combined-platform hash (no `--platform`) or a managed hash
 * that includes the native dirs would not match the per-platform device RTV that
 * stock `expo-updates` computes, so we replicate EAS's `createFingerprintAsync`
 * invocation exactly.
 */
export const fingerprintCliArgs = (
  projectRoot: string,
  options: RunFingerprintOptions,
): readonly string[] => {
  const args = ["@expo/fingerprint", projectRoot];
  if (options.platform !== undefined) {
    args.push("--platform", options.platform);
    if (options.workflow === "managed") {
      for (const ignorePath of MANAGED_FINGERPRINT_IGNORE_PATHS) {
        args.push("--ignore-path", ignorePath);
      }
    }
  }
  return args;
};

export const runFingerprintFull = (
  projectRoot: string,
  options: RunFingerprintOptions = {},
): Effect.Effect<FingerprintResult, FingerprintError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const cmd = Command.make("bunx", ...fingerprintCliArgs(projectRoot, options)).pipe(
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

/**
 * Compute the per-platform fingerprint the way EAS does: detect the workflow,
 * then run `@expo/fingerprint` with `--platform <platform>` and (for the managed
 * workflow) the native-dir `--ignore-path` filters. This is the hash that
 * becomes the `fingerprint`-policy runtimeVersion, so it MUST match the device's
 * per-platform RTV — use this rather than the bare {@link runFingerprintFull}
 * for anything that feeds a fingerprint RTV.
 */
export const runFingerprintForPlatform = (
  projectRoot: string,
  platform: Platform,
): Effect.Effect<
  FingerprintResult,
  FingerprintError,
  CommandExecutor.CommandExecutor | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const workflow = yield* resolveExpoWorkflow(projectRoot, platform);
    return yield* runFingerprintFull(projectRoot, { platform, workflow });
  });
