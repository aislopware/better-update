import { env } from "cloudflare:test";
import { Effect } from "effect";

import { toApiUpdate } from "../../../src/http/to-api";
import { UpdateRepo, UpdateRepoLive } from "../../../src/repositories/updates";
import { runWithLayerAndEnv } from "../../helpers/runtime";

// Item 1 (server persistence): git provenance round-trips on an update.
// CreateUpdateBody carries optional gitCommit + gitDirty; the handler threads
// them into the DO -> publish-coordination -> UpdateRepo.insert, which binds the
// git_commit / git_dirty columns added in migration 0052. Reads hydrate them
// back through toUpdate -> toApiUpdate. Runs against real local D1 via
// @cloudflare/vitest-pool-workers (no wrangler / unstable_startWorker): we drive
// the repository directly (the HTTP/auth path is e2e-covered) to assert the
// column binding + the default-when-absent behaviour the migration guarantees.

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, UpdateRepo>) =>
  runWithLayerAndEnv(effect, UpdateRepoLive, env);

const insertAsset = (hash: string) =>
  env.DB.prepare(
    `INSERT INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "created_at") VALUES (?, 'application/javascript', 'js', 2048, ?, '2024-01-10T00:00:00.000Z')`,
  )
    .bind(hash, `assets/${hash}`)
    .run();

describe("UpdateRepo — git provenance round-trip (real D1)", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const organizationId = `org-git-${suffix}`;
  const projectId = `proj-git-${suffix}`;
  const branchId = `branch-git-${suffix}`;
  const runtimeVersion = "30.0.0";

  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, 'Git Org', ?, '2024-01-01')`,
    )
      .bind(organizationId, `git-org-${suffix}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at") VALUES (?, ?, 'Git Project', ?, '2024-01-01T00:00:00.000Z')`,
    )
      .bind(projectId, organizationId, `git-app-${suffix}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, 'main', '2024-01-01T00:00:00.000Z')`,
    )
      .bind(branchId, projectId)
      .run();
  });

  it("persists git_commit + git_dirty and hydrates them onto the read model + API schema", async () => {
    const launchHash = `launch-git-${suffix}-a`;
    await insertAsset(launchHash);
    const commit = "0123456789abcdef0123456789abcdef01234567";

    const inserted = await run(
      Effect.gen(function* () {
        const repo = yield* UpdateRepo;
        return yield* repo.insert({
          branchId,
          runtimeVersion,
          platform: "ios",
          message: "with git provenance",
          metadataJson: "{}",
          extraJson: null,
          groupId: `group-git-${suffix}-a`,
          rolloutPercentage: 100,
          isRollback: false,
          signature: null,
          certificateChain: null,
          manifestBody: null,
          directiveBody: null,
          fingerprintHash: null,
          gitCommit: commit,
          gitDirty: true,
          assets: [{ key: "bundle", hash: launchHash, isLaunch: true }],
        });
      }),
    );

    // Read model carries the git fields.
    expect(inserted.gitCommit).toBe(commit);
    expect(inserted.gitDirty).toBe(true);

    // Raw D1 row stores the SHA + dirty flag as 0/1 INTEGER.
    const row = await env.DB.prepare(
      `SELECT "git_commit" AS gitCommit, "git_dirty" AS gitDirty FROM "updates" WHERE "id" = ?`,
    )
      .bind(inserted.id)
      .first<{ gitCommit: string | null; gitDirty: number }>();
    expect(row?.gitCommit).toBe(commit);
    expect(row?.gitDirty).toBe(1);

    // The API schema mapper surfaces the same values to clients.
    const api = toApiUpdate(inserted);
    expect(api.gitCommit).toBe(commit);
    expect(api.gitDirty).toBe(true);

    // findById re-hydrates identically (no write-path-only shape divergence).
    const refetched = await run(
      Effect.gen(function* () {
        const repo = yield* UpdateRepo;
        return yield* repo.findById({ id: inserted.id });
      }),
    );
    expect(refetched.gitCommit).toBe(commit);
    expect(refetched.gitDirty).toBe(true);
  });

  it("stores NULL commit + clean tree when git fields are absent (migration default)", async () => {
    const launchHash = `launch-git-${suffix}-b`;
    await insertAsset(launchHash);

    const inserted = await run(
      Effect.gen(function* () {
        const repo = yield* UpdateRepo;
        return yield* repo.insert({
          branchId,
          runtimeVersion,
          platform: "ios",
          message: "no git",
          metadataJson: "{}",
          extraJson: null,
          groupId: `group-git-${suffix}-b`,
          rolloutPercentage: 100,
          isRollback: false,
          signature: null,
          certificateChain: null,
          manifestBody: null,
          directiveBody: null,
          fingerprintHash: null,
          // Non-git project / empty repo: commit unknown, tree treated as clean.
          gitCommit: null,
          gitDirty: false,
          assets: [{ key: "bundle", hash: launchHash, isLaunch: true }],
        });
      }),
    );

    expect(inserted.gitCommit).toBeNull();
    expect(inserted.gitDirty).toBe(false);

    const row = await env.DB.prepare(
      `SELECT "git_commit" AS gitCommit, "git_dirty" AS gitDirty FROM "updates" WHERE "id" = ?`,
    )
      .bind(inserted.id)
      .first<{ gitCommit: string | null; gitDirty: number }>();
    expect(row?.gitCommit).toBeNull();
    // git_dirty defaults to 0 (clean) per the NOT NULL DEFAULT 0 column.
    expect(row?.gitDirty).toBe(0);
  });
});
