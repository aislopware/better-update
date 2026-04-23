import {
  getCompatibleBuildsForChannel,
  getMissingRuntimeVersionsForChannel,
} from "./-channel-compatibility-helpers";

const productionStatus = {
  channelId: "channel-production",
  channelName: "production",
  updateCount: 2,
  latestUpdateId: "update-1",
  latestUpdateMessage: "Release",
  latestUpdateCreatedAt: "2026-01-02T00:00:00Z",
  isPaused: false,
  rolloutActive: false,
};

const compatibilityRows = [
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
    message: "iOS build",
    metadataJson: "{}",
    createdAt: "2026-01-01T00:00:00Z",
    artifact: null,
    channels: [productionStatus],
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
    message: "Android build",
    metadataJson: "{}",
    createdAt: "2026-01-03T00:00:00Z",
    artifact: null,
    channels: [],
  },
];

const missingRuntimeVersions = [
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
];

describe("channel compatibility helpers", () => {
  it("maps build rows into compatible builds for a channel", () => {
    expect(getCompatibleBuildsForChannel(compatibilityRows, "channel-production")).toStrictEqual([
      {
        build: compatibilityRows[0],
        status: productionStatus,
      },
    ]);
  });

  it("filters missing runtime versions by channel", () => {
    expect(
      getMissingRuntimeVersionsForChannel(missingRuntimeVersions, "channel-production"),
    ).toStrictEqual(missingRuntimeVersions);
    expect(
      getMissingRuntimeVersionsForChannel(missingRuntimeVersions, "channel-staging"),
    ).toStrictEqual([]);
  });
});
