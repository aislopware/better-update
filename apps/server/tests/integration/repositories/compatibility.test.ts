import { env } from "cloudflare:test";
import { Effect } from "effect";

import { buildBranchMapping } from "../../../src/domain/branch-mapping";
import { CompatibilityRepo, CompatibilityRepoLive } from "../../../src/repositories/compatibility";
import { runWithLayerAndEnv } from "../../helpers/runtime";

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, CompatibilityRepo>) =>
  runWithLayerAndEnv(effect, CompatibilityRepoLive, env);

const insertOrg = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${id}`, `${id}-slug`, "2024-01-01T00:00:00Z")
    .run();

const insertProject = (id: string, organizationId: string) =>
  env.DB.prepare(
    `INSERT INTO "projects" ("id", "organization_id", "name", "scope_key", "created_at") VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, organizationId, `Project ${id}`, `@test/${id}`, "2024-01-01T00:00:00Z")
    .run();

const insertBranch = (id: string, projectId: string, name: string) =>
  env.DB.prepare(
    `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, projectId, name, "2024-01-02T00:00:00Z")
    .run();

const insertChannel = (params: {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly branchId: string;
  readonly branchMappingJson?: string | null;
  readonly isPaused?: boolean;
}) =>
  env.DB.prepare(
    `INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "branch_mapping_json", "cache_version", "is_paused", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      params.id,
      params.projectId,
      params.name,
      params.branchId,
      params.branchMappingJson ?? null,
      0,
      params.isPaused ? 1 : 0,
      "2024-01-03T00:00:00Z",
    )
    .run();

const insertBuild = (params: {
  readonly id: string;
  readonly projectId: string;
  readonly platform: "ios" | "android";
  readonly runtimeVersion: string | null;
  readonly createdAt: string;
  readonly appVersion?: string;
  readonly buildNumber?: string;
  readonly distribution?: string;
}) =>
  env.DB.prepare(
    `INSERT INTO "builds" ("id", "project_id", "platform", "profile", "distribution", "runtime_version", "app_version", "build_number", "bundle_id", "git_ref", "git_commit", "message", "metadata_json", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      params.id,
      params.projectId,
      params.platform,
      "production",
      params.distribution ?? "development",
      params.runtimeVersion,
      params.appVersion ?? "1.0.0",
      params.buildNumber ?? "1",
      `com.example.${params.id}`,
      null,
      null,
      `${params.platform} build`,
      "{}",
      params.createdAt,
    )
    .run();

const insertUpdate = (params: {
  readonly id: string;
  readonly branchId: string;
  readonly runtimeVersion: string;
  readonly platform: "ios" | "android";
  readonly message: string;
  readonly createdAt: string;
  readonly rolloutPercentage?: number;
}) =>
  env.DB.prepare(
    `INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "extra_json", "group_id", "rollout_percentage", "is_rollback", "signature", "certificate_chain", "manifest_body", "directive_body", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      params.id,
      params.branchId,
      params.runtimeVersion,
      params.platform,
      params.message,
      "{}",
      null,
      `group-${params.id}`,
      params.rolloutPercentage ?? 100,
      0,
      null,
      null,
      null,
      null,
      params.createdAt,
    )
    .run();

const identityRolloutMapping = (branchId: string) =>
  buildBranchMapping({
    newBranchId: branchId,
    oldBranchId: branchId,
    percentage: 50,
    salt: `salt-${branchId}`,
  });

describe("CompatibilityRepo -- D1 integration", () => {
  test("returns build-to-channel compatibility with latest update metadata", async () => {
    const suffix = crypto.randomUUID();
    const organizationId = `org-compat-${suffix}`;
    const projectId = `proj-compat-${suffix}`;
    const mainBranchId = `branch-main-${suffix}`;
    const previewBranchId = `branch-preview-${suffix}`;
    const pausedBranchId = `branch-paused-${suffix}`;

    await insertOrg(organizationId);
    await insertProject(projectId, organizationId);
    await insertBranch(mainBranchId, projectId, "main");
    await insertBranch(previewBranchId, projectId, "preview");
    await insertBranch(pausedBranchId, projectId, "paused");
    await insertChannel({
      id: `channel-production-${suffix}`,
      projectId,
      name: "production",
      branchId: mainBranchId,
    });
    await insertChannel({
      id: `channel-preview-${suffix}`,
      projectId,
      name: "preview",
      branchId: previewBranchId,
      branchMappingJson: identityRolloutMapping(previewBranchId),
    });
    await insertChannel({
      id: `channel-paused-${suffix}`,
      projectId,
      name: "paused",
      branchId: pausedBranchId,
      isPaused: true,
    });

    await insertBuild({
      id: `build-ios-${suffix}`,
      projectId,
      platform: "ios",
      runtimeVersion: "1.0.0",
      appVersion: "1.2.0",
      buildNumber: "42",
      createdAt: "2024-01-10T00:00:00Z",
    });
    await insertBuild({
      id: `build-android-${suffix}`,
      projectId,
      platform: "android",
      runtimeVersion: "1.0.0",
      appVersion: "1.2.0",
      buildNumber: "12",
      createdAt: "2024-01-11T00:00:00Z",
    });

    await insertUpdate({
      id: `update-ios-old-${suffix}`,
      branchId: mainBranchId,
      runtimeVersion: "1.0.0",
      platform: "ios",
      message: "Old iOS release",
      createdAt: "2024-01-04T00:00:00Z",
    });
    await insertUpdate({
      id: `update-ios-new-${suffix}`,
      branchId: mainBranchId,
      runtimeVersion: "1.0.0",
      platform: "ios",
      message: "Latest iOS release",
      createdAt: "2024-01-05T00:00:00Z",
    });
    await insertUpdate({
      id: `update-android-${suffix}`,
      branchId: mainBranchId,
      runtimeVersion: "1.0.0",
      platform: "android",
      message: "Latest Android release",
      createdAt: "2024-01-06T00:00:00Z",
    });
    await insertUpdate({
      id: `update-preview-${suffix}`,
      branchId: previewBranchId,
      runtimeVersion: "1.0.0",
      platform: "ios",
      message: "Preview rollout",
      createdAt: "2024-01-07T00:00:00Z",
    });

    const result = await run(
      Effect.gen(function* () {
        const repo = yield* CompatibilityRepo;
        return yield* repo.getBuildMatrix({ projectId });
      }),
    );

    expect(result.rows).toHaveLength(2);

    const iosBuild = result.rows.find((row) => row.platform === "ios");
    expect(iosBuild).toBeDefined();
    expect(iosBuild!.channels).toHaveLength(3);

    const production = iosBuild!.channels.find((entry) => entry.channelName === "production");
    expect(production).toMatchObject({
      updateCount: 1,
      latestUpdateMessage: "Latest iOS release",
      isPaused: false,
      rolloutActive: false,
    });

    const preview = iosBuild!.channels.find((entry) => entry.channelName === "preview");
    expect(preview).toMatchObject({
      updateCount: 1,
      latestUpdateMessage: "Preview rollout",
      isPaused: false,
      rolloutActive: true,
    });

    const paused = iosBuild!.channels.find((entry) => entry.channelName === "paused");
    expect(paused).toMatchObject({
      updateCount: 0,
      isPaused: true,
      rolloutActive: false,
    });

    const androidBuild = result.rows.find((row) => row.platform === "android");
    expect(
      androidBuild?.channels.find((entry) => entry.channelName === "production")?.updateCount,
    ).toBe(1);
    expect(
      androidBuild?.channels.find((entry) => entry.channelName === "preview")?.updateCount,
    ).toBe(0);
  });

  test("reports runtime versions that have updates but no matching builds", async () => {
    const suffix = crypto.randomUUID();
    const organizationId = `org-gap-${suffix}`;
    const projectId = `proj-gap-${suffix}`;
    const mainBranchId = `branch-gap-main-${suffix}`;
    const previewBranchId = `branch-gap-preview-${suffix}`;
    const pausedBranchId = `branch-gap-paused-${suffix}`;

    await insertOrg(organizationId);
    await insertProject(projectId, organizationId);
    await insertBranch(mainBranchId, projectId, "main");
    await insertBranch(previewBranchId, projectId, "preview");
    await insertBranch(pausedBranchId, projectId, "paused");
    await insertChannel({
      id: `channel-gap-production-${suffix}`,
      projectId,
      name: "production",
      branchId: mainBranchId,
    });
    await insertChannel({
      id: `channel-gap-preview-${suffix}`,
      projectId,
      name: "preview",
      branchId: previewBranchId,
      branchMappingJson: identityRolloutMapping(previewBranchId),
    });
    await insertChannel({
      id: `channel-gap-paused-${suffix}`,
      projectId,
      name: "paused",
      branchId: pausedBranchId,
      isPaused: true,
    });

    await insertBuild({
      id: `build-gap-ios-${suffix}`,
      projectId,
      platform: "ios",
      runtimeVersion: "1.0.0",
      createdAt: "2024-02-01T00:00:00Z",
    });

    await insertUpdate({
      id: `update-gap-main-${suffix}`,
      branchId: mainBranchId,
      runtimeVersion: "2.0.0",
      platform: "ios",
      message: "Needs new build",
      createdAt: "2024-02-03T00:00:00Z",
    });
    await insertUpdate({
      id: `update-gap-preview-${suffix}`,
      branchId: previewBranchId,
      runtimeVersion: "3.0.0",
      platform: "android",
      message: "Preview native change",
      createdAt: "2024-02-04T00:00:00Z",
    });
    await insertUpdate({
      id: `update-gap-paused-${suffix}`,
      branchId: pausedBranchId,
      runtimeVersion: "4.0.0",
      platform: "ios",
      message: "Paused channel update",
      createdAt: "2024-02-05T00:00:00Z",
    });

    const result = await run(
      Effect.gen(function* () {
        const repo = yield* CompatibilityRepo;
        return yield* repo.getBuildMatrix({ projectId });
      }),
    );

    expect(result.missingRuntimeVersions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelName: "preview",
          platform: "android",
          runtimeVersion: "3.0.0",
          latestUpdateMessage: "Preview native change",
          rolloutActive: true,
        }),
        expect.objectContaining({
          channelName: "production",
          platform: "ios",
          runtimeVersion: "2.0.0",
          latestUpdateMessage: "Needs new build",
          rolloutActive: false,
        }),
      ]),
    );
    expect(result.missingRuntimeVersions.some((entry) => entry.channelName === "paused")).toBe(
      false,
    );
  });

  test("counts both canary and stable updates when a rollout is partially active", async () => {
    const suffix = crypto.randomUUID();
    const organizationId = `org-partial-${suffix}`;
    const projectId = `proj-partial-${suffix}`;
    const branchId = `branch-partial-${suffix}`;

    await insertOrg(organizationId);
    await insertProject(projectId, organizationId);
    await insertBranch(branchId, projectId, "main");
    await insertChannel({
      id: `channel-partial-${suffix}`,
      projectId,
      name: "production",
      branchId,
    });

    await insertBuild({
      id: `build-partial-${suffix}`,
      projectId,
      platform: "ios",
      runtimeVersion: "6.0.0",
      createdAt: "2024-03-01T00:00:00Z",
    });

    await insertUpdate({
      id: `update-partial-prev-${suffix}`,
      branchId,
      runtimeVersion: "6.0.0",
      platform: "ios",
      message: "Stable release",
      createdAt: "2024-03-02T00:00:00Z",
      rolloutPercentage: 100,
    });
    await insertUpdate({
      id: `update-partial-latest-${suffix}`,
      branchId,
      runtimeVersion: "6.0.0",
      platform: "ios",
      message: "Canary release",
      createdAt: "2024-03-03T00:00:00Z",
      rolloutPercentage: 50,
    });

    const result = await run(
      Effect.gen(function* () {
        const repo = yield* CompatibilityRepo;
        return yield* repo.getBuildMatrix({ projectId });
      }),
    );

    expect(
      result.rows
        .find((row) => row.runtimeVersion === "6.0.0")
        ?.channels.find((entry) => entry.channelName === "production"),
    ).toMatchObject({
      updateCount: 2,
      latestUpdateMessage: "Canary release",
      latestUpdateId: `update-partial-latest-${suffix}`,
    });
  });

  test("includes rollout target branches in compatibility summaries and missing builds", async () => {
    const suffix = crypto.randomUUID();
    const organizationId = `org-rollout-${suffix}`;
    const projectId = `proj-rollout-${suffix}`;
    const oldBranchId = `branch-rollout-old-${suffix}`;
    const newBranchId = `branch-rollout-new-${suffix}`;

    await insertOrg(organizationId);
    await insertProject(projectId, organizationId);
    await insertBranch(oldBranchId, projectId, "main");
    await insertBranch(newBranchId, projectId, "next");
    await insertChannel({
      id: `channel-rollout-${suffix}`,
      projectId,
      name: "production",
      branchId: oldBranchId,
      branchMappingJson: buildBranchMapping({
        newBranchId,
        oldBranchId,
        percentage: 50,
        salt: `rollout-salt-${suffix}`,
      }),
    });

    await insertBuild({
      id: `build-rollout-old-${suffix}`,
      projectId,
      platform: "ios",
      runtimeVersion: "1.0.0",
      createdAt: "2024-03-01T00:00:00Z",
    });
    await insertBuild({
      id: `build-rollout-new-${suffix}`,
      projectId,
      platform: "ios",
      runtimeVersion: "2.0.0",
      createdAt: "2024-03-02T00:00:00Z",
    });

    await insertUpdate({
      id: `update-rollout-old-${suffix}`,
      branchId: oldBranchId,
      runtimeVersion: "1.0.0",
      platform: "ios",
      message: "Old branch release",
      createdAt: "2024-03-03T00:00:00Z",
    });
    await insertUpdate({
      id: `update-rollout-new-${suffix}`,
      branchId: newBranchId,
      runtimeVersion: "2.0.0",
      platform: "ios",
      message: "New branch release",
      createdAt: "2024-03-04T00:00:00Z",
    });
    await insertUpdate({
      id: `update-rollout-android-${suffix}`,
      branchId: newBranchId,
      runtimeVersion: "3.0.0",
      platform: "android",
      message: "New branch native change",
      createdAt: "2024-03-05T00:00:00Z",
    });

    const result = await run(
      Effect.gen(function* () {
        const repo = yield* CompatibilityRepo;
        return yield* repo.getBuildMatrix({ projectId });
      }),
    );

    const newRuntimeBuild = result.rows.find((row) => row.runtimeVersion === "2.0.0");
    expect(
      newRuntimeBuild?.channels.find((entry) => entry.channelName === "production"),
    ).toMatchObject({
      updateCount: 1,
      latestUpdateMessage: "New branch release",
      rolloutActive: true,
    });

    expect(result.missingRuntimeVersions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelName: "production",
          platform: "android",
          runtimeVersion: "3.0.0",
          updateCount: 1,
          latestUpdateMessage: "New branch native change",
          rolloutActive: true,
        }),
      ]),
    );
  });

  test("resolves compatibility against servable fallback updates when latest is reverted", async () => {
    const suffix = crypto.randomUUID();
    const organizationId = `org-reverted-${suffix}`;
    const projectId = `proj-reverted-${suffix}`;
    const branchId = `branch-reverted-${suffix}`;

    await insertOrg(organizationId);
    await insertProject(projectId, organizationId);
    await insertBranch(branchId, projectId, "main");
    await insertChannel({
      id: `channel-reverted-${suffix}`,
      projectId,
      name: "production",
      branchId,
    });

    await insertBuild({
      id: `build-reverted-${suffix}`,
      projectId,
      platform: "ios",
      runtimeVersion: "7.0.0",
      createdAt: "2024-04-01T00:00:00Z",
    });

    await insertUpdate({
      id: `update-reverted-prev-${suffix}`,
      branchId,
      runtimeVersion: "7.0.0",
      platform: "ios",
      message: "Stable release",
      createdAt: "2024-04-02T00:00:00Z",
      rolloutPercentage: 100,
    });
    await insertUpdate({
      id: `update-reverted-latest-${suffix}`,
      branchId,
      runtimeVersion: "7.0.0",
      platform: "ios",
      message: "Reverted release",
      createdAt: "2024-04-03T00:00:00Z",
      rolloutPercentage: 0,
    });
    await insertUpdate({
      id: `update-gap-prev-${suffix}`,
      branchId,
      runtimeVersion: "8.0.0",
      platform: "android",
      message: "Android stable",
      createdAt: "2024-04-04T00:00:00Z",
      rolloutPercentage: 100,
    });
    await insertUpdate({
      id: `update-gap-reverted-${suffix}`,
      branchId,
      runtimeVersion: "8.0.0",
      platform: "android",
      message: "Android reverted",
      createdAt: "2024-04-05T00:00:00Z",
      rolloutPercentage: 0,
    });

    const result = await run(
      Effect.gen(function* () {
        const repo = yield* CompatibilityRepo;
        return yield* repo.getBuildMatrix({ projectId });
      }),
    );

    expect(
      result.rows
        .find((row) => row.runtimeVersion === "7.0.0")
        ?.channels.find((entry) => entry.channelName === "production"),
    ).toMatchObject({
      updateCount: 1,
      latestUpdateMessage: "Stable release",
      latestUpdateId: `update-reverted-prev-${suffix}`,
    });

    expect(result.missingRuntimeVersions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelName: "production",
          platform: "android",
          runtimeVersion: "8.0.0",
          updateCount: 1,
          latestUpdateMessage: "Android stable",
          latestUpdateId: `update-gap-prev-${suffix}`,
        }),
      ]),
    );
  });
});
