import path from "node:path";

import { Effect } from "effect";

import type { FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";

import { findNewestFileUnder } from "./artifact-finder";

/**
 * A crash-symbolication file captured from the native build output, pending
 * upload alongside the build record. Capture and upload are both best-effort:
 * a missing symbol file must never fail a build that produced its artifact.
 */
export interface CapturedDebugArtifact {
  readonly type: "dsym" | "js-sourcemap" | "proguard-mapping" | "native-symbols";
  readonly path: string;
}

/**
 * Collect Android debug outputs after a Gradle build. All paths are the
 * documented Gradle/RN-plugin output locations; each is optional (mapping.txt
 * only exists with R8 minification, native symbols only with NDK code,
 * sourcemaps only when the RN plugin emitted them for this variant).
 */
export const collectAndroidDebugArtifacts = (params: {
  readonly projectRoot: string;
  readonly module: string;
  readonly minMtimeMs: number;
}): Effect.Effect<readonly CapturedDebugArtifact[], PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const buildDir = path.join(params.projectRoot, "android", params.module, "build");
    const candidates = [
      {
        type: "proguard-mapping",
        root: path.join(buildDir, "outputs", "mapping"),
        extension: ".txt",
      },
      {
        type: "js-sourcemap",
        root: path.join(buildDir, "generated", "sourcemaps", "react"),
        extension: ".map",
      },
      {
        type: "native-symbols",
        root: path.join(buildDir, "outputs", "native-debug-symbols"),
        extension: ".zip",
      },
    ] as const;

    // eslint-disable-next-line unicorn/no-array-method-this-argument -- Effect.forEach, not Array.prototype.forEach; the second arg is a mapping effect, not a thisArg
    const found = yield* Effect.forEach(candidates, (candidate) =>
      findNewestFileUnder({
        root: candidate.root,
        extension: candidate.extension,
        minMtimeMs: params.minMtimeMs,
      }).pipe(
        Effect.map((filePath): CapturedDebugArtifact | null =>
          filePath ? { type: candidate.type, path: filePath } : null,
        ),
      ),
    );

    return found.filter((artifact): artifact is CapturedDebugArtifact => artifact !== null);
  });
