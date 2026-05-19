import type { BuildCompatibilityMatrixResult, BuildWithArtifact } from "@better-update/api";

export interface SyntheticBuildChannel {
  readonly channelId: string;
  readonly channelName: string;
  readonly updateCount: number;
  readonly latestUpdateId: string | null;
  readonly latestUpdateMessage: string | null;
  readonly latestUpdateCreatedAt: string | null;
  readonly isPaused: boolean;
  readonly rolloutActive: boolean;
}

export interface BuildWithSyntheticChannels {
  readonly id: string;
  readonly projectId: string;
  readonly platform: (typeof BuildWithArtifact.Type)["platform"];
  readonly profile: string;
  readonly distribution: (typeof BuildWithArtifact.Type)["distribution"];
  readonly runtimeVersion: string | null;
  readonly appVersion: string | null;
  readonly buildNumber: string | null;
  readonly bundleId: string | null;
  readonly gitRef: string | null;
  readonly gitCommit: string | null;
  readonly gitDirty: boolean;
  readonly message: string | null;
  readonly metadataJson: string;
  readonly fingerprintHash: string | null;
  readonly createdAt: string;
  readonly artifact: (typeof BuildWithArtifact.Type)["artifact"];
  readonly channels: readonly SyntheticBuildChannel[];
}

const buildKey = (platform: string, runtimeVersion: string | null): string | null =>
  runtimeVersion === null ? null : `${platform}:${runtimeVersion}`;

export const synthesizeBuildChannels = (
  build: typeof BuildWithArtifact.Type,
  matrix: typeof BuildCompatibilityMatrixResult.Type,
): BuildWithSyntheticChannels => {
  const key = buildKey(build.platform, build.runtimeVersion);
  const statuses = key === null ? [] : (matrix.channelStatusByKey[key] ?? []);

  const channels: SyntheticBuildChannel[] = matrix.channels.map((channel) => {
    const status = statuses.find((entry) => entry.channelId === channel.channelId);
    return {
      channelId: channel.channelId,
      channelName: channel.channelName,
      updateCount: status === undefined ? 0 : status.updateCount,
      latestUpdateId: status === undefined ? null : status.latestUpdateId,
      latestUpdateMessage: status === undefined ? null : status.latestUpdateMessage,
      latestUpdateCreatedAt: status === undefined ? null : status.latestUpdateCreatedAt,
      isPaused: channel.isPaused,
      rolloutActive: channel.rolloutActive,
    };
  });

  return {
    id: build.id,
    projectId: build.projectId,
    platform: build.platform,
    profile: build.profile,
    distribution: build.distribution,
    runtimeVersion: build.runtimeVersion,
    appVersion: build.appVersion,
    buildNumber: build.buildNumber,
    bundleId: build.bundleId,
    gitRef: build.gitRef,
    gitCommit: build.gitCommit,
    gitDirty: build.gitDirty,
    message: build.message,
    metadataJson: build.metadataJson,
    fingerprintHash: build.fingerprintHash,
    createdAt: build.createdAt,
    artifact: build.artifact,
    channels,
  };
};
