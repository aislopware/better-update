import { env } from "cloudflare:test";
import { Effect, Layer } from "effect";

import { publishUpdate } from "../../../src/application/publish-coordination";
import { ChannelRepoLive } from "../../../src/repositories/channels";
import { ProjectRepoLive } from "../../../src/repositories/projects";
import { UpdateRepo, UpdateRepoLive } from "../../../src/repositories/updates";
import { runEitherWithLayerAndEnv, runWithLayerAndEnv } from "../../helpers/runtime";

import type { Conflict } from "../../../src/errors";
import type { ChannelRepo } from "../../../src/repositories/channels";
import type { ProjectRepo } from "../../../src/repositories/projects";

// Repository-level integration coverage (real D1 via @cloudflare/vitest-pool-workers)
// for the embedded-baseline id-pinning contract: insert() binds an explicit id
// when supplied (the embedded path pins the binary's app.manifest UUID) and
// mints a server crypto.randomUUID() otherwise (the default + signed-render
// paths are unchanged). The trust-boundary validation (UUID-format, ownership,
// embedded-requirement) lives in the domain/handler layers and is covered by
// colocated unit tests; here we verify the persistence binding + the
// per-(branch,rtv,platform) uniqueness flip the handler relies on.
//
// Negative-path / trust-boundary coverage (the id-injection failure modes):
//   • insert() surfaces a typed Conflict (NOT a 500/defect) on a duplicate PK,
//     and the colliding write is aborted — the original row is never overwritten.
//   • publishUpdate re-registers the SAME embedded id for the SAME tuple
//     idempotently (delete-then-insert under the DO single-writer lock).
//   • publishUpdate rejects an embedded id already bound to a DIFFERENT
//     tuple/project with a clean Conflict (override impossible).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, UpdateRepo>) =>
  runWithLayerAndEnv(effect, UpdateRepoLive, env);

const runEither = <Ret, Err>(effect: Effect.Effect<Ret, Err, UpdateRepo>) =>
  runEitherWithLayerAndEnv(effect, UpdateRepoLive, env);

// publishUpdate needs UpdateRepo + ChannelRepo + ProjectRepo; the cache/activity
// bumps it performs are plain UPDATEs that no-op when no channel/project row
// matches, so the org/project/branch fixtures below are sufficient.
const PublishLayer = Layer.mergeAll(UpdateRepoLive, ChannelRepoLive, ProjectRepoLive);

const runPublish = <Ret, Err>(
  effect: Effect.Effect<Ret, Err, ChannelRepo | ProjectRepo | UpdateRepo>,
) => runWithLayerAndEnv(effect, PublishLayer, env);

const publishEmbedded = (params: {
  readonly id: string;
  readonly branchId: string;
  readonly runtimeVersion: string;
  readonly launchHash: string;
  readonly message: string;
}) =>
  runPublish(
    publishUpdate({
      id: params.id,
      branchId: params.branchId,
      runtimeVersion: params.runtimeVersion,
      platform: "ios",
      message: params.message,
      metadataJson: "{}",
      extraJson: null,
      groupId: `group-${params.message}`,
      rolloutPercentage: 100,
      isRollback: false,
      signature: null,
      certificateChain: null,
      manifestBody: null,
      directiveBody: null,
      fingerprintHash: null,
      gitCommit: null,
      gitDirty: false,
      isEmbedded: true,
      assets: [{ key: "bundle", hash: params.launchHash, isLaunch: true }],
      conflictMessage: "rollout-conflict",
    }),
  );

const insertOrg = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, '2024-01-01T00:00:00.000Z')`,
  )
    .bind(id, `Org ${id}`, `${id}-slug`)
    .run();

const insertProject = (id: string, organizationId: string) =>
  env.DB.prepare(
    `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at") VALUES (?, ?, ?, ?, '2024-01-01T00:00:00.000Z')`,
  )
    .bind(id, organizationId, `Project ${id}`, `test-${id}`)
    .run();

const insertBranch = (id: string, projectId: string) =>
  env.DB.prepare(
    `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, 'main', '2024-01-02T00:00:00.000Z')`,
  )
    .bind(id, projectId)
    .run();

const insertAsset = (hash: string) =>
  env.DB.prepare(
    `INSERT INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "created_at") VALUES (?, 'application/javascript', 'js', 2048, ?, '2024-01-10T00:00:00.000Z')`,
  )
    .bind(hash, `assets/${hash}`)
    .run();

const baseInsert = (overrides: {
  readonly branchId: string;
  readonly runtimeVersion: string;
  readonly launchHash: string;
  readonly id?: string;
  readonly isEmbedded?: boolean;
  readonly message?: string;
}) =>
  run(
    Effect.gen(function* () {
      const repo = yield* UpdateRepo;
      if (overrides.isEmbedded) {
        yield* repo.clearEmbeddedBaseline({
          branchId: overrides.branchId,
          platform: "ios",
          runtimeVersion: overrides.runtimeVersion,
        });
      }
      return yield* repo.insert({
        ...(overrides.id === undefined ? {} : { id: overrides.id }),
        branchId: overrides.branchId,
        runtimeVersion: overrides.runtimeVersion,
        platform: "ios",
        message: overrides.message ?? "embedded baseline",
        metadataJson: "{}",
        extraJson: null,
        groupId: `group-${overrides.message ?? overrides.id ?? overrides.launchHash}`,
        rolloutPercentage: 100,
        isRollback: false,
        signature: null,
        certificateChain: null,
        manifestBody: null,
        directiveBody: null,
        fingerprintHash: null,
        gitCommit: null,
        gitDirty: false,
        isEmbedded: overrides.isEmbedded ?? false,
        assets: [{ key: "bundle", hash: overrides.launchHash, isLaunch: true }],
      });
    }),
  );

const embeddedRowCount = async (branchId: string, runtimeVersion: string) => {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM "updates" WHERE "branch_id" = ? AND "runtime_version" = ? AND "platform" = 'ios' AND "is_embedded" = 1`,
  )
    .bind(branchId, runtimeVersion)
    .first<{ n: number }>();
  return row?.n ?? 0;
};

describe("UpdateRepo.insert — embedded-baseline id pinning", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const organizationId = `org-pin-${suffix}`;
  const projectId = `proj-pin-${suffix}`;
  const branchId = `branch-pin-${suffix}`;
  // A second project + branch, to prove a pinned id cannot be re-bound across the
  // project boundary (no cross-project override).
  const otherProjectId = `proj-pin2-${suffix}`;
  const otherBranchId = `branch-pin2-${suffix}`;
  const runtimeVersion = "20.0.0";

  beforeAll(async () => {
    await insertOrg(organizationId);
    await insertProject(projectId, organizationId);
    await insertBranch(branchId, projectId);
    await insertProject(otherProjectId, organizationId);
    await insertBranch(otherBranchId, otherProjectId);
  });

  it("registers an embedded baseline under the supplied lowercase-UUID id", async () => {
    const pinnedId = `aaaaaaaa-1111-2222-3333-${suffix}00000000`;
    const launchHash = `launch-pin-${suffix}-a`;
    await insertAsset(launchHash);

    const inserted = await baseInsert({
      branchId,
      runtimeVersion,
      launchHash,
      id: pinnedId,
      isEmbedded: true,
      message: "pinned-embedded",
    });

    expect(inserted.id).toBe(pinnedId);

    // The row exists under THAT id, flagged as the embedded baseline.
    const row = await env.DB.prepare(
      `SELECT "id" AS id, "is_embedded" AS isEmbedded FROM "updates" WHERE "id" = ?`,
    )
      .bind(pinnedId)
      .first<{ id: string; isEmbedded: number }>();
    expect(row?.id).toBe(pinnedId);
    expect(row?.isEmbedded).toBe(1);

    // The launch bundle bytes are referenced (diffable patch base is present).
    const launch = await env.DB.prepare(
      `SELECT "asset_hash" AS hash FROM "update_assets" WHERE "update_id" = ? AND "is_launch" = 1`,
    )
      .bind(pinnedId)
      .first<{ hash: string }>();
    expect(launch?.hash).toBe(launchHash);
  });

  it("mints a fresh server UUID for a non-embedded create with no id (unchanged default path)", async () => {
    const launchHash = `launch-pin-${suffix}-b`;
    await insertAsset(launchHash);

    const inserted = await baseInsert({
      branchId,
      runtimeVersion: "21.0.0",
      launchHash,
      message: "default-no-id",
    });

    expect(UUID_RE.test(inserted.id)).toBe(true);
    const row = await env.DB.prepare(`SELECT "id" AS id FROM "updates" WHERE "id" = ?`)
      .bind(inserted.id)
      .first<{ id: string }>();
    expect(row?.id).toBe(inserted.id);
  });

  it("persists a client-supplied id on a non-embedded create (signed-render path unbroken)", async () => {
    const signedId = `bbbbbbbb-4444-5555-6666-${suffix}00000000`;
    const launchHash = `launch-pin-${suffix}-c`;
    await insertAsset(launchHash);

    const inserted = await baseInsert({
      branchId,
      runtimeVersion: "22.0.0",
      launchHash,
      id: signedId,
      message: "signed-non-embedded",
    });

    expect(inserted.id).toBe(signedId);
    const row = await env.DB.prepare(
      `SELECT "id" AS id, "is_embedded" AS isEmbedded FROM "updates" WHERE "id" = ?`,
    )
      .bind(signedId)
      .first<{ id: string; isEmbedded: number }>();
    expect(row?.id).toBe(signedId);
    // Not an embedded baseline — the gate never fired for this row.
    expect(row?.isEmbedded).toBe(0);
  });

  it("flips the baseline across two embedded ids so exactly one remains per (branch,rtv,platform)", async () => {
    const rtv = "23.0.0";
    const firstId = `cccccccc-7777-8888-9999-${suffix}00000000`;
    const secondId = `dddddddd-7777-8888-9999-${suffix}00000000`;
    const launchHash = `launch-pin-${suffix}-d`;
    await insertAsset(launchHash);

    await baseInsert({
      branchId,
      runtimeVersion: rtv,
      launchHash,
      id: firstId,
      isEmbedded: true,
      message: "embedded-flip-1",
    });
    expect(await embeddedRowCount(branchId, rtv)).toBe(1);

    await baseInsert({
      branchId,
      runtimeVersion: rtv,
      launchHash,
      id: secondId,
      isEmbedded: true,
      message: "embedded-flip-2",
    });

    // Only one embedded baseline survives, and it is the latest (pinned) id.
    expect(await embeddedRowCount(branchId, rtv)).toBe(1);
    const survivor = await env.DB.prepare(
      `SELECT "id" AS id FROM "updates" WHERE "branch_id" = ? AND "runtime_version" = ? AND "platform" = 'ios' AND "is_embedded" = 1`,
    )
      .bind(branchId, rtv)
      .first<{ id: string }>();
    expect(survivor?.id).toBe(secondId);

    const firstRow = await env.DB.prepare(
      `SELECT "is_embedded" AS isEmbedded FROM "updates" WHERE "id" = ?`,
    )
      .bind(firstId)
      .first<{ isEmbedded: number }>();
    expect(firstRow?.isEmbedded).toBe(0);
  });

  it("insert() surfaces a typed Conflict (not a 500) on a duplicate id and never overwrites the original row", async () => {
    const dupId = `eeeeeeee-1111-2222-3333-${suffix}00000000`;
    const firstHash = `launch-pin-${suffix}-e1`;
    const secondHash = `launch-pin-${suffix}-e2`;
    await insertAsset(firstHash);
    await insertAsset(secondHash);

    // First insert lands.
    await baseInsert({
      branchId,
      runtimeVersion: "24.0.0",
      launchHash: firstHash,
      id: dupId,
      message: "dup-original",
    });

    // Second insert with the SAME id collides on the PRIMARY KEY. It must fail
    // with a typed Conflict (a recoverable value), NOT die into a 500.
    const result = await runEither(
      Effect.gen(function* () {
        const repo = yield* UpdateRepo;
        return yield* repo.insert({
          id: dupId,
          branchId,
          runtimeVersion: "24.0.0",
          platform: "ios",
          message: "dup-attempt",
          metadataJson: "{}",
          extraJson: null,
          groupId: `group-dup-${suffix}`,
          rolloutPercentage: 100,
          isRollback: false,
          signature: null,
          certificateChain: null,
          manifestBody: null,
          directiveBody: null,
          fingerprintHash: null,
          gitCommit: null,
          gitDirty: false,
          isEmbedded: false,
          assets: [{ key: "bundle", hash: secondHash, isLaunch: true }],
        });
      }),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      const error = result.left as Conflict;
      expect(error._tag).toBe("Conflict");
      expect(error.message).toContain("already exists");
    }

    // The original row is intact — the colliding batch was aborted, nothing
    // overwritten (the launch hash is still the FIRST one).
    const launch = await env.DB.prepare(
      `SELECT "asset_hash" AS hash FROM "update_assets" WHERE "update_id" = ? AND "is_launch" = 1`,
    )
      .bind(dupId)
      .first<{ hash: string }>();
    expect(launch?.hash).toBe(firstHash);
    const message = await env.DB.prepare(`SELECT "message" AS m FROM "updates" WHERE "id" = ?`)
      .bind(dupId)
      .first<{ m: string }>();
    expect(message?.m).toBe("dup-original");
  });

  it("publishUpdate re-registers the SAME embedded id for the SAME tuple idempotently (no 500, replace)", async () => {
    const rtv = "25.0.0";
    const pinnedId = `ffffffff-1111-2222-3333-${suffix}00000000`;
    const firstHash = `launch-pin-${suffix}-f1`;
    const secondHash = `launch-pin-${suffix}-f2`;
    await insertAsset(firstHash);
    await insertAsset(secondHash);

    const first = await publishEmbedded({
      id: pinnedId,
      branchId,
      runtimeVersion: rtv,
      launchHash: firstHash,
      message: "embedded-idem-1",
    });
    expect(first.ok).toBe(true);
    expect(await embeddedRowCount(branchId, rtv)).toBe(1);

    // Re-upload the SAME --embedded-id (the binary's stable app.manifest UUID)
    // after a reset/retry: idempotent success, NOT a PK-collision 500.
    const second = await publishEmbedded({
      id: pinnedId,
      branchId,
      runtimeVersion: rtv,
      launchHash: secondHash,
      message: "embedded-idem-2",
    });
    expect(second.ok).toBe(true);

    // Exactly one embedded baseline remains under the pinned id, now pointing at
    // the re-uploaded bytes (the row was replaced).
    expect(await embeddedRowCount(branchId, rtv)).toBe(1);
    const survivor = await env.DB.prepare(
      `SELECT "id" AS id, "message" AS m FROM "updates" WHERE "branch_id" = ? AND "runtime_version" = ? AND "platform" = 'ios' AND "is_embedded" = 1`,
    )
      .bind(branchId, rtv)
      .first<{ id: string; m: string }>();
    expect(survivor?.id).toBe(pinnedId);
    expect(survivor?.m).toBe("embedded-idem-2");
    const launch = await env.DB.prepare(
      `SELECT "asset_hash" AS hash FROM "update_assets" WHERE "update_id" = ? AND "is_launch" = 1`,
    )
      .bind(pinnedId)
      .first<{ hash: string }>();
    expect(launch?.hash).toBe(secondHash);
  });

  it("publishUpdate rejects an embedded id already bound to a DIFFERENT project with a clean Conflict (no override)", async () => {
    const rtv = "26.0.0";
    const pinnedId = `99999999-1111-2222-3333-${suffix}00000000`;
    const ownHash = `launch-pin-${suffix}-g1`;
    const otherHash = `launch-pin-${suffix}-g2`;
    await insertAsset(ownHash);
    await insertAsset(otherHash);

    // The id is first registered under the OTHER project's branch.
    const owned = await publishEmbedded({
      id: pinnedId,
      branchId: otherBranchId,
      runtimeVersion: rtv,
      launchHash: otherHash,
      message: "embedded-cross-owner",
    });
    expect(owned.ok).toBe(true);

    // A publish under THIS project's branch that pins the SAME id must be a clean
    // Conflict — never an override of the other project's row.
    const collision = await publishEmbedded({
      id: pinnedId,
      branchId,
      runtimeVersion: rtv,
      launchHash: ownHash,
      message: "embedded-cross-attacker",
    });
    expect(collision.ok).toBe(false);
    if (!collision.ok) {
      expect(collision.message).toContain("already in use");
    }

    // The other project's row is untouched: still its branch, its bytes.
    const row = await env.DB.prepare(
      `SELECT "branch_id" AS branchId, "message" AS m FROM "updates" WHERE "id" = ?`,
    )
      .bind(pinnedId)
      .first<{ branchId: string; m: string }>();
    expect(row?.branchId).toBe(otherBranchId);
    expect(row?.m).toBe("embedded-cross-owner");
    const launch = await env.DB.prepare(
      `SELECT "asset_hash" AS hash FROM "update_assets" WHERE "update_id" = ? AND "is_launch" = 1`,
    )
      .bind(pinnedId)
      .first<{ hash: string }>();
    expect(launch?.hash).toBe(otherHash);
  });
});
