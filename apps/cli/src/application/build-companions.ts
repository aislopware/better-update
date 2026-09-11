import { Effect } from "effect";

import { uploadDebugArtifacts } from "../commands/build/upload-debug-artifacts";
import { uploadInstallArtifact } from "../commands/build/upload-install-artifact";
import { exportArtifact } from "./build-artifact-output";

import type { BuildTarget } from "../commands/build/reserve-and-upload";
import type { apiClient } from "../services/api-client";
import type { runPlatformBuild } from "./platform-build";

type PlatformBuildOutput = Effect.Success<ReturnType<typeof runPlatformBuild>>;
type NativeBuild = PlatformBuildOutput["build"];

/**
 * Copy the artifact to `--output`; for an `.aab` the universal APK lands
 * beside it as `<name>.universal.apk` — the file a tester actually installs.
 * Returns the exported artifact path, or undefined without `--output`.
 */
export const exportBuildOutputs = (params: {
  readonly build: NativeBuild;
  readonly userCwd: string;
  readonly output: string | undefined;
}) =>
  Effect.gen(function* () {
    if (params.output === undefined) {
      return undefined;
    }
    const exportedArtifactPath = yield* exportArtifact({
      artifactPath: params.build.artifactPath,
      userCwd: params.userCwd,
      output: params.output,
    });
    if (params.build.installArtifact !== undefined) {
      yield* exportArtifact({
        artifactPath: params.build.installArtifact.path,
        userCwd: params.userCwd,
        output: `${exportedArtifactPath.replace(/\.aab$/u, "")}.universal.apk`,
      });
    }
    return exportedArtifactPath;
  });

/** Only an `.aab` build has a universal-APK story worth a summary row. */
export const universalApkRow = (target: BuildTarget, status: string) =>
  target.artifactFormat === "aab" ? [["Universal APK", status] as const] : [];

/**
 * Best-effort attachments once the artifact itself is stored: the universal
 * APK (so the dashboard's Install link and `builds run` have something a
 * device accepts) and the crash-symbolication files (dSYM, JS sourcemap, R8
 * mapping, NDK symbols). The artifact above is already the deliverable — a
 * failure here only warns and shows up in the summary.
 */
export const attachBuildCompanions = (
  api: Effect.Success<typeof apiClient>,
  params: { readonly buildId: string; readonly build: NativeBuild },
) =>
  Effect.gen(function* () {
    const { build, buildId } = params;
    const universalApk =
      build.installArtifact === undefined
        ? "none"
        : yield* uploadInstallArtifact(api, { buildId, artifact: build.installArtifact }).pipe(
            Effect.map((stored) => (stored ? "attached" : "upload failed")),
          );
    const debugArtifacts =
      build.debugArtifacts.length === 0
        ? []
        : yield* uploadDebugArtifacts(api, { buildId, artifacts: build.debugArtifacts });
    return { universalApk, debugArtifacts };
  });
