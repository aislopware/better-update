import { screen } from "@testing-library/react";

import { renderWithQuery } from "../../../../../../tests/helpers/render-with-query";
import { BuildsTab } from "./-builds-tab";
import { ChannelsTab } from "./-channels-tab";

const { buildCardModule, compatibilityMatrixModule, channelCardModule, createChannelDialogModule } =
  vi.hoisted(() => ({
    buildCardModule: "./-build-card",
    compatibilityMatrixModule: "./-compatibility-matrix",
    channelCardModule: "./-channel-card",
    createChannelDialogModule: "./-create-channel-dialog",
  }));

vi.mock(buildCardModule, () => ({
  BuildCard: ({ build }: { build: { message: string } }) => <div>Build card: {build.message}</div>,
}));

vi.mock(compatibilityMatrixModule, () => ({
  CompatibilityMatrix: ({
    rows,
    missingRuntimeVersions,
  }: {
    rows: unknown[];
    missingRuntimeVersions: unknown[];
  }) => (
    <div>{`Matrix rows: ${rows.length}; Missing runtimes: ${missingRuntimeVersions.length}`}</div>
  ),
}));

vi.mock(channelCardModule, () => ({
  ChannelCard: ({
    channel,
    compatibleBuilds,
    missingRuntimeVersions,
  }: {
    channel: { name: string };
    compatibleBuilds: unknown[];
    missingRuntimeVersions: unknown[];
  }) => (
    <div>
      Channel card: {channel.name} / builds {compatibleBuilds.length} / missing{" "}
      {missingRuntimeVersions.length}
    </div>
  ),
}));

vi.mock(createChannelDialogModule, () => ({
  CreateChannelDialog: () => <button type="button">Create channel</button>,
}));

const buildRows = [
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
    channels: [
      {
        channelId: "channel-production",
        channelName: "production",
        updateCount: 2,
        latestUpdateId: "update-ios",
        latestUpdateMessage: "iOS release",
        latestUpdateCreatedAt: "2026-01-02T00:00:00Z",
        isPaused: false,
        rolloutActive: false,
      },
      {
        channelId: "channel-staging",
        channelName: "staging",
        updateCount: 0,
        latestUpdateId: null,
        latestUpdateMessage: null,
        latestUpdateCreatedAt: null,
        isPaused: false,
        rolloutActive: false,
      },
    ],
  },
  {
    id: "build-2",
    projectId: "proj-1",
    platform: "android" as const,
    profile: "production",
    distribution: "development" as const,
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
    channels: [
      {
        channelId: "channel-production",
        channelName: "production",
        updateCount: 0,
        latestUpdateId: null,
        latestUpdateMessage: null,
        latestUpdateCreatedAt: null,
        isPaused: false,
        rolloutActive: false,
      },
      {
        channelId: "channel-staging",
        channelName: "staging",
        updateCount: 1,
        latestUpdateId: "update-android",
        latestUpdateMessage: "Android release",
        latestUpdateCreatedAt: "2026-01-04T00:00:00Z",
        isPaused: false,
        rolloutActive: false,
      },
    ],
  },
];

const compatibilityData = {
  rows: buildRows,
  missingRuntimeVersions: [
    {
      channelId: "channel-staging",
      channelName: "staging",
      platform: "android" as const,
      runtimeVersion: "3.0.0",
      updateCount: 1,
      latestUpdateId: "update-native",
      latestUpdateMessage: "Native change",
      latestUpdateCreatedAt: "2026-01-05T00:00:00Z",
      rolloutActive: true,
    },
  ],
};

const channelsData = {
  items: [
    {
      id: "channel-production",
      projectId: "proj-1",
      name: "production",
      branchId: "branch-main",
      branchMappingJson: null,
      cacheVersion: 0,
      isPaused: false,
      createdAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "channel-staging",
      projectId: "proj-1",
      name: "staging",
      branchId: "branch-staging",
      branchMappingJson: null,
      cacheVersion: 0,
      isPaused: false,
      createdAt: "2026-01-02T00:00:00Z",
    },
  ],
  total: 2,
  page: 1,
  limit: 1000,
};

const branchesData = {
  items: [
    {
      id: "branch-main",
      projectId: "proj-1",
      name: "main",
      createdAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "branch-staging",
      projectId: "proj-1",
      name: "staging",
      createdAt: "2026-01-02T00:00:00Z",
    },
  ],
  total: 2,
  page: 1,
  limit: 1000,
};

describe("builds and channels tabs", () => {
  test("BuildsTab renders matrix summary and build cards from compatibility data", () => {
    renderWithQuery(<BuildsTab orgId="org-1" projectId="proj-1" />, {
      seedCache: [
        [["org", "org-1", "projects", "proj-1", "build-compatibility-matrix"], compatibilityData],
      ],
    });

    expect(screen.getByText("Matrix rows: 2; Missing runtimes: 1")).toBeInTheDocument();
    expect(screen.getByText("Build card: iOS build")).toBeInTheDocument();
    expect(screen.getByText("Build card: Android build")).toBeInTheDocument();
  });

  test("BuildsTab shows empty state when there are no builds", () => {
    renderWithQuery(<BuildsTab orgId="org-1" projectId="proj-1" />, {
      seedCache: [
        [
          ["org", "org-1", "projects", "proj-1", "build-compatibility-matrix"],
          { rows: [], missingRuntimeVersions: [] },
        ],
      ],
    });

    expect(screen.getByText("No builds yet")).toBeInTheDocument();
    expect(
      screen.getByText("Upload your first build using the CLI to get started."),
    ).toBeInTheDocument();
  });

  test("ChannelsTab maps compatibility data into per-channel card props", () => {
    renderWithQuery(<ChannelsTab orgId="org-1" projectId="proj-1" />, {
      seedCache: [
        [["org", "org-1", "projects", "proj-1", "channels"], channelsData],
        [["org", "org-1", "projects", "proj-1", "branches"], branchesData],
        [["org", "org-1", "projects", "proj-1", "build-compatibility-matrix"], compatibilityData],
      ],
    });

    expect(screen.getByText("Channel card: production / builds 2 / missing 0")).toBeInTheDocument();
    expect(screen.getByText("Channel card: staging / builds 2 / missing 1")).toBeInTheDocument();
  });

  test("ChannelsTab shows empty state when there are no channels", () => {
    renderWithQuery(<ChannelsTab orgId="org-1" projectId="proj-1" />, {
      seedCache: [
        [
          ["org", "org-1", "projects", "proj-1", "channels"],
          { items: [], total: 0, page: 1, limit: 1000 },
        ],
        [
          ["org", "org-1", "projects", "proj-1", "branches"],
          { items: [], total: 0, page: 1, limit: 1000 },
        ],
        [
          ["org", "org-1", "projects", "proj-1", "build-compatibility-matrix"],
          { rows: [], missingRuntimeVersions: [] },
        ],
      ],
    });

    expect(screen.getByText("No channels yet")).toBeInTheDocument();
    expect(
      screen.getByText("Create your first channel to start distributing updates."),
    ).toBeInTheDocument();
  });
});
