import { env } from "cloudflare:test";

import { handleBuildGc } from "../../src/handlers/build-gc";

// Integration tests for the BUILD-artifact retention reaper against the real
// local D1 + R2 bindings (@cloudflare/vitest-pool-workers — no wrangler, no
// startWorker). Mirrors ota-gc.test.ts but for the SEPARATE build-gc handler.
//
// handleBuildGc reads retention purely from env.BUILD_RETENTION_* (wrangler.jsonc
// vars: production=90, preview=30, development=7 days). There is no
// cutoff-parameterized program to drive directly — the test controls reaping
// entirely via builds.created_at + builds.profile, then runs `handleBuildGc(env)`
// (which internally provides ServerInfrastructureLayer + the Cloudflare env).
//
// Retention contract (pure TTL by profile, NO keep-current / NO keep-referenced):
//   reap iff builds.profile ∈ {production,preview,development}
//        AND builds.created_at < (now - retentionDays).
// For each reaped batch the handler deletes the R2 blob from BUILD_BUCKET, then
// the build_artifacts row. The `builds` row is NEVER deleted — only the
// build_artifacts row + the R2 blob.

const insertProject = (id: string, orgId: string, slug: string) =>
  env.DB.prepare(
    `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at") VALUES (?, ?, 'GC Project', ?, '2020-01-01T00:00:00.000Z')`,
  )
    .bind(id, orgId, slug)
    .run();

const insertOrg = (id: string, slug: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, 'GC Org', ?, '2020-01-01')`,
  )
    .bind(id, slug)
    .run();

const insertBuild = (params: {
  readonly id: string;
  readonly projectId: string;
  readonly profile: string;
  readonly createdAt: string;
  readonly platform?: string;
  readonly distribution?: string;
}) =>
  env.DB.prepare(
    `INSERT INTO "builds" ("id", "project_id", "platform", "profile", "distribution", "metadata_json", "created_at") VALUES (?, ?, ?, ?, ?, '{}', ?)`,
  )
    .bind(
      params.id,
      params.projectId,
      params.platform ?? "ios",
      params.profile,
      params.distribution ?? "development",
      params.createdAt,
    )
    .run();

const insertArtifact = (buildId: string, r2Key: string, createdAt: string, format = "tar.gz") =>
  env.DB.prepare(
    `INSERT INTO "build_artifacts" ("build_id", "r2_key", "format", "content_type", "byte_size", "sha256", "created_at") VALUES (?, ?, ?, 'application/octet-stream', 1024, ?, ?)`,
  )
    .bind(buildId, r2Key, format, `sha-${buildId}`, createdAt)
    .run();

const putBlob = (r2Key: string) => env.BUILD_BUCKET.put(r2Key, new Uint8Array([1]));

const artifactRow = (buildId: string) =>
  env.DB.prepare(`SELECT "build_id" FROM "build_artifacts" WHERE "build_id" = ?`)
    .bind(buildId)
    .first();

const buildRow = (buildId: string) =>
  env.DB.prepare(`SELECT "id" FROM "builds" WHERE "id" = ?`).bind(buildId).first();

// Beyond every cutoff (prod 90 / preview 30 / dev 7); within every cutoff.
const OLD = "2020-01-01T00:00:00.000Z";
const RECENT = new Date().toISOString();
// 14 days old: beyond the development cutoff (7d) but within the preview cutoff (30d).
const AGE_14 = new Date(Date.now() - 14 * 86_400_000).toISOString();

describe("build-gc reaper (real D1 + R2)", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const orgId = `org-bgc-${suffix}`;
  const projectId = `proj-bgc-${suffix}`;

  const bProdOld = `bgc-prod-old-${suffix}`;
  const bProdRecent = `bgc-prod-recent-${suffix}`;
  const bPrev14 = `bgc-prev-14-${suffix}`;
  const bDev14 = `bgc-dev-14-${suffix}`;
  const bOther = `bgc-other-${suffix}`;
  const bDevBatch = Array.from({ length: 5 }, (_, index) => `bgc-dev-batch-${index}-${suffix}`);

  const keyProdOld = `builds/${projectId}/${bProdOld}.tar.gz`;
  const keyProdRecent = `builds/${projectId}/${bProdRecent}.tar.gz`;
  const keyPrev14 = `builds/${projectId}/${bPrev14}.tar.gz`;
  const keyDev14 = `builds/${projectId}/${bDev14}.tar.gz`;
  const keyOther = `builds/${projectId}/${bOther}.tar.gz`;
  const keyDevBatch = bDevBatch.map((id) => `builds/${projectId}/${id}.tar.gz`);

  beforeAll(async () => {
    await insertOrg(orgId, `bgc-org-${suffix}`);
    await insertProject(projectId, orgId, `bgc-app-${suffix}`);

    // Old production build (>90d) — should be reaped.
    await insertBuild({ id: bProdOld, projectId, profile: "production", createdAt: OLD });
    await insertArtifact(bProdOld, keyProdOld, OLD);
    await putBlob(keyProdOld);

    // Recent production build (<90d) — within TTL, kept.
    await insertBuild({ id: bProdRecent, projectId, profile: "production", createdAt: RECENT });
    await insertArtifact(bProdRecent, keyProdRecent, RECENT);
    await putBlob(keyProdRecent);

    // 14-day-old preview build (preview TTL=30d) — within TTL, kept.
    await insertBuild({ id: bPrev14, projectId, profile: "preview", createdAt: AGE_14 });
    await insertArtifact(bPrev14, keyPrev14, AGE_14);
    await putBlob(keyPrev14);

    // 14-day-old development build (development TTL=7d) — beyond TTL, reaped.
    await insertBuild({ id: bDev14, projectId, profile: "development", createdAt: AGE_14 });
    await insertArtifact(bDev14, keyDev14, AGE_14);
    await putBlob(keyDev14);

    // Ancient build with an unrecognized profile — never queried, never reaped.
    await insertBuild({ id: bOther, projectId, profile: "staging", createdAt: OLD });
    await insertArtifact(bOther, keyOther, OLD);
    await putBlob(keyOther);

    // Five old development builds — exercises the iterate/while-hasMore batch loop.
    for (let index = 0; index < bDevBatch.length; index += 1) {
      await insertBuild({
        id: bDevBatch[index]!,
        projectId,
        profile: "development",
        createdAt: OLD,
      });
      await insertArtifact(bDevBatch[index]!, keyDevBatch[index]!, OLD);
      await putBlob(keyDevBatch[index]!);
    }
  });

  it("reaps an old production build artifact (>90d): R2 blob + artifact row gone, builds row kept", async () => {
    await handleBuildGc(env);

    // R2 blob deleted from BUILD_BUCKET.
    expect(await env.BUILD_BUCKET.get(keyProdOld)).toBeNull();
    // build_artifacts row deleted.
    expect(await artifactRow(bProdOld)).toBeNull();
    // The builds row itself is NEVER deleted by the reaper — only the artifact + blob.
    expect(await buildRow(bProdOld), "builds row must survive the reaper").not.toBeNull();
  });

  it("keeps a recent production build (<90d) within retention", async () => {
    expect(await env.BUILD_BUCKET.get(keyProdRecent)).not.toBeNull();
    expect(await artifactRow(bProdRecent), "recent build artifact must survive").not.toBeNull();
  });

  it("applies a per-profile cutoff: preview keeps a 14-day-old, development reaps it", async () => {
    // preview retention=30d, so 14d < cutoff is FALSE => kept.
    expect(await env.BUILD_BUCKET.get(keyPrev14)).not.toBeNull();
    expect(
      await artifactRow(bPrev14),
      "14d-old preview within 30d TTL must survive",
    ).not.toBeNull();

    // development retention=7d, so 14d IS beyond cutoff => reaped.
    expect(await env.BUILD_BUCKET.get(keyDev14)).toBeNull();
    expect(
      await artifactRow(bDev14),
      "14d-old development beyond 7d TTL must be reaped",
    ).toBeNull();
  });

  it("never reaps a build with an unrecognized profile, even if ancient", async () => {
    // The handler only iterates ['production','preview','development']; 'staging'
    // is never queried regardless of age.
    expect(await env.BUILD_BUCKET.get(keyOther)).not.toBeNull();
    expect(
      await artifactRow(bOther),
      "unrecognized-profile build must be untouched",
    ).not.toBeNull();
  });

  it("batch-reaps many old builds in one profile (covers the iterate batch loop)", async () => {
    // All five old development builds reaped: artifact rows + R2 blobs gone.
    for (let index = 0; index < bDevBatch.length; index += 1) {
      expect(
        await env.BUILD_BUCKET.get(keyDevBatch[index]!),
        `batch blob ${index} must be deleted`,
      ).toBeNull();
      expect(
        await artifactRow(bDevBatch[index]!),
        `batch artifact row ${index} must be deleted`,
      ).toBeNull();
    }
  });

  it("is idempotent: a second run deletes nothing new and does not throw", async () => {
    await expect(handleBuildGc(env)).resolves.toBeUndefined();

    // Already-reaped rows stay gone.
    expect(await artifactRow(bProdOld)).toBeNull();
    expect(await artifactRow(bDev14)).toBeNull();
    // Within-TTL / kept rows stay present.
    expect(await artifactRow(bProdRecent)).not.toBeNull();
    expect(await artifactRow(bPrev14)).not.toBeNull();
    expect(await artifactRow(bOther)).not.toBeNull();
  });
});
