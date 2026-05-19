import { screen } from "@testing-library/react";

import { renderWithQuery } from "../../../../../../tests/helpers/render-with-query";
import { BuildCard } from "./-build-card";
import { ChannelCard } from "./-channel-card";

const { deleteBuildDialogModule, installLinkDialogModule, deleteChannelDialogModule } = vi.hoisted(
  () => ({
    deleteBuildDialogModule: "./-delete-build-dialog",
    installLinkDialogModule: "./-install-link-dialog",
    deleteChannelDialogModule: "./-delete-channel-dialog",
  }),
);

vi.mock(deleteBuildDialogModule, () => ({
  DeleteBuildDialog: () => <div>Delete build dialog</div>,
}));

vi.mock(installLinkDialogModule, () => ({
  InstallLinkDialog: () => <div>Install link dialog</div>,
}));

vi.mock(deleteChannelDialogModule, () => ({
  DeleteChannelDialog: () => <div>Delete channel dialog</div>,
}));

const productionStatus = {
  channelId: "channel-production",
  channelName: "production",
  updateCount: 2,
  latestUpdateId: "update-canary",
  latestUpdateMessage: "Canary release",
  latestUpdateCreatedAt: "2026-01-02T00:00:00Z",
  isPaused: false,
  rolloutActive: true,
};

const pausedStatus = {
  channelId: "channel-paused",
  channelName: "paused",
  updateCount: 0,
  latestUpdateId: null,
  latestUpdateMessage: null,
  latestUpdateCreatedAt: null,
  isPaused: true,
  rolloutActive: false,
};

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
  message: "Release build",
  metadataJson: "{}",
  fingerprintHash: null,
  createdAt: "2026-01-01T00:00:00Z",
  artifact: null,
  channels: [productionStatus, pausedStatus],
};

const activeRolloutChannel = {
  id: "channel-production",
  projectId: "proj-1",
  name: "production",
  branchId: "branch-main",
  branchMappingJson:
    '{"data":[{"branchId":"branch-next","branchMappingLogic":"hash_lt(mappingId, 0.50)"},{"branchId":"branch-main","branchMappingLogic":"true"}],"salt":"salt"}',
  cacheVersion: 0,
  isPaused: false,
  createdAt: "2026-01-01T00:00:00Z",
};

const pausedChannel = {
  id: "channel-paused",
  projectId: "proj-1",
  name: "paused",
  branchId: "branch-main",
  branchMappingJson: null,
  cacheVersion: 0,
  isPaused: true,
  createdAt: "2026-01-01T00:00:00Z",
};

const branches = [
  {
    id: "branch-main",
    projectId: "proj-1",
    name: "main",
    createdAt: "2026-01-01T00:00:00Z",
    updateCount: 0,
  },
  {
    id: "branch-next",
    projectId: "proj-1",
    name: "next",
    createdAt: "2026-01-02T00:00:00Z",
    updateCount: 0,
  },
];

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

describe("build and channel cards", () => {
  it("buildCard renders compatibility statuses from the matrix data", () => {
    renderWithQuery(
      <BuildCard build={build} orgId="org-1" projectId="proj-1" projectSlug="my-app" />,
    );

    expect(screen.getByText("Compatible channels")).toBeInTheDocument();
    expect(screen.getByText("production")).toBeInTheDocument();
    expect(screen.getByText("2 updates")).toBeInTheDocument();
    expect(screen.getByText("Rollout active")).toBeInTheDocument();
    expect(screen.getByText("latest Canary release")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View details" })).toHaveAttribute(
      "href",
      "/projects/my-app/builds/build-1",
    );
  });

  it("buildCard shows missing runtimeVersion guidance when compatibility cannot be determined", () => {
    renderWithQuery(
      <BuildCard
        build={{ ...build, runtimeVersion: null }}
        orgId="org-1"
        projectId="proj-1"
        projectSlug="my-app"
      />,
    );

    expect(
      screen.getByText(
        "This build is missing `runtimeVersion`, so OTA compatibility cannot be determined.",
      ),
    ).toBeInTheDocument();
  });

  it("channelCard renders rollout state, compatible builds, and missing build warnings", () => {
    renderWithQuery(
      <ChannelCard
        channel={activeRolloutChannel}
        orgId="org-1"
        projectId="proj-1"
        projectSlug="my-app"
        branches={branches}
        compatibleBuilds={[{ build, status: productionStatus }]}
        missingRuntimeVersions={[missingRuntimeVersion]}
      />,
    );

    expect(screen.getByText("production")).toBeInTheDocument();
    expect(screen.getByText("Rolling out to next at 50%")).toBeInTheDocument();
    expect(screen.getByText("Compatible builds")).toBeInTheDocument();
    expect(screen.getByText("Missing matching builds")).toBeInTheDocument();
    expect(screen.getByText("latest Canary release")).toBeInTheDocument();
    expect(screen.getByText("android v3.0.0")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View details" })).toHaveAttribute(
      "href",
      "/projects/my-app/channels/channel-production",
    );
  });

  it("channelCard still renders paused channels without rollout controls", () => {
    renderWithQuery(
      <ChannelCard
        channel={pausedChannel}
        orgId="org-1"
        projectId="proj-1"
        projectSlug="my-app"
        branches={branches}
        compatibleBuilds={[]}
        missingRuntimeVersions={[]}
      />,
    );

    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("Start Rollout")).toBeInTheDocument();
    expect(
      screen.getByText("No builds have been uploaded for this project yet."),
    ).toBeInTheDocument();
  });
});
