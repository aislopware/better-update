import type {
  BuildCompatibilityChannel,
  BuildCompatibilityRow,
  MissingRuntimeVersionBuild,
} from "@better-update/api";

export interface CompatibleBuildEntry {
  readonly build: typeof BuildCompatibilityRow.Type;
  readonly status: typeof BuildCompatibilityChannel.Type;
}

export const getCompatibleBuildsForChannel = (
  rows: readonly (typeof BuildCompatibilityRow.Type)[],
  channelId: string,
): CompatibleBuildEntry[] =>
  rows.flatMap((build) => {
    const status = build.channels.find((entry) => entry.channelId === channelId);
    return status ? [{ build, status }] : [];
  });

export const getMissingRuntimeVersionsForChannel = (
  missingRuntimeVersions: readonly (typeof MissingRuntimeVersionBuild.Type)[],
  channelId: string,
) => missingRuntimeVersions.filter((entry) => entry.channelId === channelId);
