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

export const getCompatibleBuildsForChannel = (
  builds: readonly BuildWithArtifact[],
  matrix: typeof BuildCompatibilityMatrixResult.Type,
  channelId: string,
): CompatibleBuildEntry[] =>
  builds.flatMap((rawBuild) => {
    const build = synthesizeBuildChannels(rawBuild, matrix);
    const status = build.channels.find((entry) => entry.channelId === channelId);
    return status && status.updateCount > 0 ? [{ build, status }] : [];
  });

export const getMissingRuntimeVersionsForChannel = (
  missingRuntimeVersions: readonly MissingRuntimeVersionBuild[],
  channelId: string,
) => missingRuntimeVersions.filter((entry) => entry.channelId === channelId);
