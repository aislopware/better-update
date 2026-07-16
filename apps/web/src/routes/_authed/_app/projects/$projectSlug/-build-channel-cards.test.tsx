import { branchesQueryKey } from "@better-update/api-client/react";
import { screen } from "@testing-library/react";

import { renderWithQuery } from "../../../../../../tests/helpers/render-with-query";
import { DROPDOWN_FETCH_LIMIT } from "../../../../../queries/constants";
import { ChannelBuildsCard } from "./-channel-builds-card";
import { ChannelRolloutCard } from "./-channel-rollout-card";

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
  branchName: "main",
  rolloutTargetBranchName: "next",
  branchMappingJson:
    '{"data":[{"branchId":"branch-next","branchMappingLogic":"hash_lt(mappingId, 0.50)"},{"branchId":"branch-main","branchMappingLogic":"true"}],"salt":"salt"}',
  cacheVersion: 0,
  isPaused: false,
  isBuiltin: false,
  createdAt: "2026-01-01T00:00:00Z",
};

const pausedChannel = {
  id: "channel-paused",
  projectId: "proj-1",
  name: "paused",
  branchId: "branch-main",
  branchName: "main",
  branchMappingJson: null,
  cacheVersion: 0,
  isPaused: true,
  isBuiltin: false,
  createdAt: "2026-01-01T00:00:00Z",
};

const branches = [
  {
    id: "branch-main",
    projectId: "proj-1",
    name: "main",
    createdAt: "2026-01-01T00:00:00Z",
    isBuiltin: false,
    updateCount: 0,
  },
  {
    id: "branch-next",
    projectId: "proj-1",
    name: "next",
    createdAt: "2026-01-02T00:00:00Z",
    isBuiltin: false,
    updateCount: 0,
  },
];

// Seeds the server-search branch pickers' default page so the rollout card's
// useServerSearchList hooks resolve from cache instead of fetching.
const branchesSeed: [readonly unknown[], unknown] = [
  [...branchesQueryKey("org-1", "proj-1"), { limit: DROPDOWN_FETCH_LIMIT }],
  { items: branches, total: branches.length, page: 1, limit: DROPDOWN_FETCH_LIMIT },
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
  it("channelRolloutCard renders active rollout controls with labeled inputs", () => {
    renderWithQuery(
      <ChannelRolloutCard channel={activeRolloutChannel} orgId="org-1" projectId="proj-1" />,
      { seedCache: [branchesSeed] },
    );

    expect(screen.getByText("Branch & rollout")).toBeInTheDocument();
    expect(screen.getByText("Linked branch")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByLabelText("Rollout percentage")).toHaveValue(50);
    expect(screen.getByRole("button", { name: /Complete rollout/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Revert/ })).toBeInTheDocument();
  });

  it("channelRolloutCard offers to start a rollout when none is active", () => {
    renderWithQuery(
      <ChannelRolloutCard channel={pausedChannel} orgId="org-1" projectId="proj-1" />,
      { seedCache: [branchesSeed] },
    );

    expect(screen.getByRole("button", { name: /Start rollout/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Complete rollout/ })).not.toBeInTheDocument();
  });

  it("channelBuildsCard renders compatible builds and missing build warnings", () => {
    renderWithQuery(
      <ChannelBuildsCard
        projectSlug="my-app"
        compatibleBuilds={[{ build, status: productionStatus }]}
        totalCount={1}
        missingRuntimeVersions={[missingRuntimeVersion]}
      />,
    );

    expect(screen.getByText("Compatible builds")).toBeInTheDocument();
    expect(screen.getByText("2 updates")).toBeInTheDocument();
    expect(screen.getByText("Missing matching builds")).toBeInTheDocument();
    expect(screen.getByText("v3.0.0")).toBeInTheDocument();
    expect(screen.getByText("1 update but no uploaded build.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Release build" })).toHaveAttribute(
      "href",
      "/projects/my-app/builds/build-1",
    );
  });

  it("channelBuildsCard renders an empty state when no builds match", () => {
    renderWithQuery(
      <ChannelBuildsCard
        projectSlug="my-app"
        compatibleBuilds={[]}
        totalCount={0}
        missingRuntimeVersions={[]}
      />,
    );

    expect(
      screen.getByText("No uploaded builds can install this channel's updates yet."),
    ).toBeInTheDocument();
  });

  it("channelBuildsCard links to all builds when the server total exceeds the visible rows", () => {
    renderWithQuery(
      <ChannelBuildsCard
        projectSlug="my-app"
        compatibleBuilds={[{ build, status: productionStatus }]}
        totalCount={9}
        missingRuntimeVersions={[]}
      />,
    );

    expect(
      screen.getByRole("link", { name: "8 more compatible builds — view all builds →" }),
    ).toHaveAttribute("href", "/projects/my-app/builds");
  });
});
