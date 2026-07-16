import type {
  BuildCompatibilityMatrixResult,
  BuildWithArtifact,
  MissingRuntimeVersionBuild,
} from "@better-update/api";

import { synthesizeBuildChannels } from "./-compatibility-join";

import type { BuildWithSyntheticChannels, SyntheticBuildChannel } from "./-compatibility-join";

export interface CompatibleBuildEntry {
  readonly build: BuildWithSyntheticChannels;
  readonly status: SyntheticBuildChannel;
}

/**
 * Decorate server-filtered compatible builds (GET /api/channels/:id/compatible-builds)
 * with their matrix status for the update-count badge. The server already
 * applied the compatibility filter, so no `updateCount > 0` re-check here — a
 * row whose channel is missing from a momentarily stale matrix is dropped
 * rather than shown unlabeled.
 */
export const toCompatibleBuildEntries = (
  builds: readonly BuildWithArtifact[],
  matrix: typeof BuildCompatibilityMatrixResult.Type,
  channelId: string,
): CompatibleBuildEntry[] =>
  builds.flatMap((rawBuild) => {
    const build = synthesizeBuildChannels(rawBuild, matrix);
    const status = build.channels.find((entry) => entry.channelId === channelId);
    return status ? [{ build, status }] : [];
  });

export const getMissingRuntimeVersionsForChannel = (
  missingRuntimeVersions: readonly MissingRuntimeVersionBuild[],
  channelId: string,
) => missingRuntimeVersions.filter((entry) => entry.channelId === channelId);
