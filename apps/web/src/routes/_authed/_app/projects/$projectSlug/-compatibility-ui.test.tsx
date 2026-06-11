import { render, screen } from "@testing-library/react";

import { MissingMatchingBuilds } from "./-channel-compatibility";
import { CompatibilityMatrix } from "./-compatibility-matrix";

const build = {
  id: "build-1",
  projectId: "proj-1",
  platform: "ios" as const,
  profile: "production",
  distribution: "development" as const,
  runtimeVersion: "1.0.0",
  appVersion: "1.0.0",
  buildNumber: "42",
  bundleId: "com.example.app",
  gitRef: null,
  gitCommit: null,
  gitDirty: false,
  message: "iOS build",
  metadataJson: "{}",
  fingerprintHash: null,
  createdAt: "2026-01-01T00:00:00Z",
  artifact: null,
};

const matrix = {
  channels: [
    {
      channelId: "channel-production",
      channelName: "production",
      isPaused: false,
      rolloutActive: true,
    },
    {
      channelId: "channel-paused",
      channelName: "paused",
      isPaused: true,
      rolloutActive: false,
    },
  ],
  channelStatusByKey: {
    "ios:1.0.0": [
      {
        channelId: "channel-production",
        updateCount: 2,
        latestUpdateId: "update-canary",
        latestUpdateMessage: "Canary release",
        latestUpdateCreatedAt: "2026-01-02T00:00:00Z",
      },
      {
        channelId: "channel-paused",
        updateCount: 0,
        latestUpdateId: null,
        latestUpdateMessage: null,
        latestUpdateCreatedAt: null,
      },
    ],
  },
  missingRuntimeVersions: [],
};

const missingRuntimeVersion = {
  channelId: "channel-production",
  channelName: "production",
  platform: "android" as const,
  runtimeVersion: "3.0.0",
  updateCount: 1,
  latestUpdateId: "update-native",
  latestUpdateMessage: "Native change",
  latestUpdateCreatedAt: "2026-01-03T00:00:00Z",
  rolloutActive: true,
};

describe("compatibility UI", () => {
  it("renders compatibility matrix and missing build warnings", () => {
    render(
      <CompatibilityMatrix
        builds={[build]}
        matrix={matrix}
        missingRuntimeVersions={[missingRuntimeVersion]}
      />,
    );

    expect(screen.getByText("Builds × Channels")).toBeInTheDocument();
    expect(screen.getByText("Missing native builds")).toBeInTheDocument();
    expect(screen.getByText("iOS build")).toBeInTheDocument();
    expect(screen.getByText("Canary release")).toBeInTheDocument();
    expect(screen.getAllByText("Rollout active").length).toBeGreaterThan(0);
    expect(screen.getByText("1 updates, latest Native change")).toBeInTheDocument();
  });

  it("renders missing matching builds warnings", () => {
    render(<MissingMatchingBuilds missingRuntimeVersions={[missingRuntimeVersion]} />);

    expect(screen.getByText("Missing matching builds")).toBeInTheDocument();
    expect(screen.getByText("v3.0.0")).toBeInTheDocument();
    expect(screen.getByText("1 updates but no uploaded build.")).toBeInTheDocument();
  });
});
