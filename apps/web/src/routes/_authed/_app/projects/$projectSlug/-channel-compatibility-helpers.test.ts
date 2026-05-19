import {
  getCompatibleBuildsForChannel,
  getMissingRuntimeVersionsForChannel,
} from "./-channel-compatibility-helpers";
import { synthesizeBuildChannels } from "./-compatibility-join";

const builds = [
  {
    id: "build-1",
    projectId: "proj-1",
    platform: "ios" as const,
    profile: "production",
    distribution: "development" as const,
    runtimeVersion: "1.0.0",
    appVersion: "1.0.0",
    buildNumber: "1",
    bundleId: "com.example.ios",
    gitRef: null,
    gitCommit: null,
    gitDirty: false,
    message: "iOS build",
    metadataJson: "{}",
    fingerprintHash: null,
    createdAt: "2026-01-01T00:00:00Z",
    artifact: null,
  },
  {
    id: "build-2",
    projectId: "proj-1",
    platform: "android" as const,
    profile: "preview",
    distribution: "direct" as const,
    runtimeVersion: "2.0.0",
    appVersion: "2.0.0",
    buildNumber: "2",
    bundleId: "com.example.android",
    gitRef: null,
    gitCommit: null,
    gitDirty: false,
    message: "Android build",
    metadataJson: "{}",
    fingerprintHash: null,
    createdAt: "2026-01-03T00:00:00Z",
    artifact: null,
  },
];

const matrix = {
  channels: [
    {
      channelId: "channel-production",
      channelName: "production",
      isPaused: false,
      rolloutActive: false,
    },
  ],
  channelStatusByKey: {
    "ios:1.0.0": [
      {
        channelId: "channel-production",
        updateCount: 2,
        latestUpdateId: "update-1",
        latestUpdateMessage: "Release",
        latestUpdateCreatedAt: "2026-01-02T00:00:00Z",
      },
    ],
    "android:2.0.0": [
      {
        channelId: "channel-production",
        updateCount: 0,
        latestUpdateId: null,
        latestUpdateMessage: null,
        latestUpdateCreatedAt: null,
      },
    ],
  },
  missingRuntimeVersions: [
    {
      channelId: "channel-production",
      channelName: "production",
      platform: "android" as const,
      runtimeVersion: "3.0.0",
      updateCount: 1,
      latestUpdateId: "update-2",
      latestUpdateMessage: "Native change",
      latestUpdateCreatedAt: "2026-01-04T00:00:00Z",
      rolloutActive: true,
    },
  ],
};

describe("channel compatibility helpers", () => {
  it("maps build rows into compatible builds for a channel", () => {
    const expectedBuild = synthesizeBuildChannels(builds[0]!, matrix);
    const expectedStatus = expectedBuild.channels.find(
      (entry) => entry.channelId === "channel-production",
    );
    expect(getCompatibleBuildsForChannel(builds, matrix, "channel-production")).toStrictEqual([
      {
        build: expectedBuild,
        status: expectedStatus,
      },
    ]);
  });

  it("filters missing runtime versions by channel", () => {
    expect(
      getMissingRuntimeVersionsForChannel(matrix.missingRuntimeVersions, "channel-production"),
    ).toStrictEqual(matrix.missingRuntimeVersions);
    expect(
      getMissingRuntimeVersionsForChannel(matrix.missingRuntimeVersions, "channel-staging"),
    ).toStrictEqual([]);
  });
});
