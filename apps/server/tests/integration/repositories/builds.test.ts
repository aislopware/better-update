import { env } from "cloudflare:test";
import { Effect, Either } from "effect";

import { BuildRepo, BuildRepoLive } from "../../../src/repositories/builds";
import { runEitherWithLayerAndEnv, runWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, BuildRepo>) =>
  runWithLayerAndEnv(effect, BuildRepoLive, env);

const runEither = <Ret, Err>(effect: Effect.Effect<Ret, Err, BuildRepo>) =>
  runEitherWithLayerAndEnv(effect, BuildRepoLive, env);

const insertOrg = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${id}`, `${id}-slug`, "2024-01-01T00:00:00Z")
    .run();

const insertProject = (id: string, organizationId: string) =>
  env.DB.prepare(
    `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at") VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, organizationId, `Project ${id}`, `test-${id}`, "2024-01-01T00:00:00Z")
    .run();

const seedBuild = (params: {
  readonly id: string;
  readonly projectId: string;
  readonly createdAt: string;
  readonly message?: string;
  readonly gitCommit?: string;
  readonly gitRef?: string;
}) =>
  env.DB.prepare(
    `INSERT INTO "builds" ("id", "project_id", "platform", "profile", "distribution", "runtime_version", "app_version", "bundle_id", "git_ref", "git_commit", "message", "metadata_json", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      params.id,
      params.projectId,
      "ios",
      "production",
      "ad-hoc",
      "1.0.0",
      "1.2.3",
      "com.example.app",
      params.gitRef ?? null,
      params.gitCommit ?? null,
      params.message ?? "Seed build",
      "{}",
      params.createdAt,
    )
    .run();

const seedArtifact = (buildId: string, r2Key: string) =>
  env.DB.prepare(
    `INSERT INTO "build_artifacts" ("build_id", "r2_key", "format", "content_type", "byte_size", "sha256", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      buildId,
      r2Key,
      "ipa",
      "application/octet-stream",
      2048,
      `sha-${buildId}`,
      "2024-01-05T00:00:00Z",
    )
    .run();

const insertParams = (id: string, projectId: string) => ({
  id,
  projectId,
  platform: "ios" as const,
  profile: "production",
  distribution: "ad-hoc" as const,
  runtimeVersion: "2.0.0",
  appVersion: "9.9.9",
  buildNumber: "42",
  bundleId: "com.example.new",
  gitRef: "main",
  gitCommit: "abc123",
  gitDirty: true,
  message: "Fresh build",
  metadataJson: "{}",
  fingerprintHash: "fp-new",
  artifact: {
    r2Key: `builds/${id}.ipa`,
    format: "ipa" as const,
    contentType: "application/octet-stream",
    byteSize: 4096,
    sha256: "deadbeef",
  },
});

// ── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await insertOrg("org-build");
  await insertProject("p-list", "org-build");
  await insertProject("p-mut", "org-build");
  await insertProject("p-search", "org-build");
  // Two builds, oldest first; `bl-new` is the newer one.
  await seedBuild({ id: "bl-old", projectId: "p-list", createdAt: "2024-01-02T00:00:00Z" });
  await seedBuild({ id: "bl-new", projectId: "p-list", createdAt: "2024-01-04T00:00:00Z" });
  await seedArtifact("bl-old", "builds/bl-old.ipa");
  await seedArtifact("bl-new", "builds/bl-new.ipa");
  // Search fixtures: distinct message / git commit / git ref per build.
  await seedBuild({
    id: "bs-login",
    projectId: "p-search",
    createdAt: "2024-01-02T00:00:00Z",
    message: "Fix Login crash",
    gitCommit: "A1b2C3d4E5",
    gitRef: "feature/login-form",
  });
  await seedBuild({
    id: "bs-deps",
    projectId: "p-search",
    createdAt: "2024-01-03T00:00:00Z",
    message: "Bump deps",
    gitCommit: "ffeeddcc00",
    gitRef: "main",
  });
});

// ── Tests ─────────────────────────────────────────────────────────

describe("BuildRepo — D1 integration (Kysely + LEFT JOIN)", () => {
  it("lists builds with total, newest first", async () => {
    const page = await run(
      Effect.gen(function* () {
        const repo = yield* BuildRepo;
        return yield* repo.list({
          projectId: "p-list",
          sort: "createdAt",
          order: "desc",
          limit: 10,
          offset: 0,
        });
      }),
    );

    expect(page.total).toBe(2);
    expect(page.items.map((b) => b.id)).toEqual(["bl-new", "bl-old"]);
  });

  it("lists builds matching a case-insensitive message/commit/ref search, totals respecting it", async () => {
    const search = (query: string) =>
      run(
        Effect.gen(function* () {
          const repo = yield* BuildRepo;
          return yield* repo.list({
            projectId: "p-search",
            query,
            sort: "createdAt",
            order: "desc",
            limit: 10,
            offset: 0,
          });
        }),
      );

    // "login" hits bs-login twice (message + git ref) but must surface once.
    const byMessage = await search("LOGIN");
    expect(byMessage.total).toBe(1);
    expect(byMessage.items.map((b) => b.id)).toEqual(["bs-login"]);

    const byCommit = await search("a1b2c3");
    expect(byCommit.total).toBe(1);
    expect(byCommit.items.map((b) => b.id)).toEqual(["bs-login"]);

    const byRef = await search("main");
    expect(byRef.total).toBe(1);
    expect(byRef.items.map((b) => b.id)).toEqual(["bs-deps"]);

    const noMatch = await search("zzz-no-such");
    expect(noMatch.total).toBe(0);
    expect(noMatch.items).toHaveLength(0);
  });

  it("findById returns the build joined with its artifact", async () => {
    const build = await run(
      Effect.gen(function* () {
        const repo = yield* BuildRepo;
        return yield* repo.findById({ id: "bl-new" });
      }),
    );

    expect(build.id).toBe("bl-new");
    expect(build.platform).toBe("ios");
    expect(build.distribution).toBe("ad-hoc");
    expect(build.artifact).toMatchObject({
      r2Key: "builds/bl-new.ipa",
      format: "ipa",
      byteSize: 2048,
    });
  });

  it("findInstallInfoById returns install metadata via the artifact join", async () => {
    const info = await run(
      Effect.gen(function* () {
        const repo = yield* BuildRepo;
        return yield* repo.findInstallInfoById({ id: "bl-old" });
      }),
    );

    expect(info).toEqual({
      distribution: "ad-hoc",
      bundleId: "com.example.app",
      appVersion: "1.2.3",
      message: "Seed build",
      r2Key: "builds/bl-old.ipa",
    });
  });

  it("findById fails with NotFound for a missing build", async () => {
    const result = await runEither(
      Effect.gen(function* () {
        const repo = yield* BuildRepo;
        return yield* repo.findById({ id: "does-not-exist" });
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: "NotFound" });
    }
  });

  it("insert persists the build and its artifact atomically", async () => {
    const created = await run(
      Effect.gen(function* () {
        const repo = yield* BuildRepo;
        return yield* repo.insert(insertParams("b-ins", "p-mut"));
      }),
    );
    expect(created.id).toBe("b-ins");
    expect(created.gitDirty).toBe(true);

    const reread = await run(
      Effect.gen(function* () {
        const repo = yield* BuildRepo;
        return yield* repo.findById({ id: "b-ins" });
      }),
    );
    expect(reread.artifact).toMatchObject({ r2Key: "builds/b-ins.ipa", byteSize: 4096 });
    expect(reread.gitDirty).toBe(true);
  });

  it("deleteById returns the artifact key, removes the build, and is NotFound thereafter", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* BuildRepo;
        return yield* repo.insert(insertParams("b-del", "p-mut"));
      }),
    );

    const deleted = await run(
      Effect.gen(function* () {
        const repo = yield* BuildRepo;
        return yield* repo.deleteById({ id: "b-del" });
      }),
    );
    expect(deleted).toEqual({ r2Key: "builds/b-del.ipa" });

    const afterDelete = await runEither(
      Effect.gen(function* () {
        const repo = yield* BuildRepo;
        return yield* repo.deleteById({ id: "b-del" });
      }),
    );
    expect(Either.isLeft(afterDelete)).toBe(true);
    if (Either.isLeft(afterDelete)) {
      expect(afterDelete.left).toMatchObject({ _tag: "NotFound" });
    }
  });
});
