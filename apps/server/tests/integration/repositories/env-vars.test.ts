import { env } from "cloudflare:test";
import { Effect, Either } from "effect";

import { EnvVarRepo, EnvVarRepoLive } from "../../../src/repositories/env-vars";
import { runEitherWithLayerAndEnv, runWithLayerAndEnv } from "../../helpers/runtime";

import type { EnvVarListFilters, InsertParams } from "../../../src/repositories/env-vars-sql";

// ── Helpers ───────────────────────────────────────────────────────

const ORG_ID = "ev-org";
const PROJECT_ID = "ev-proj";

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, EnvVarRepo>) =>
  runWithLayerAndEnv(effect, EnvVarRepoLive, env);

const runEither = <Ret, Err>(effect: Effect.Effect<Ret, Err, EnvVarRepo>) =>
  runEitherWithLayerAndEnv(effect, EnvVarRepoLive, env);

const insertWithRevision = (params: InsertParams) =>
  Effect.gen(function* () {
    const repo = yield* EnvVarRepo;
    return yield* repo.insertWithRevision(params);
  });

const addRevision = (params: Parameters<EnvVarRepo["Type"]["addRevision"]>[0]) =>
  Effect.gen(function* () {
    const repo = yield* EnvVarRepo;
    return yield* repo.addRevision(params);
  });

const list = (filters: EnvVarListFilters) =>
  Effect.gen(function* () {
    const repo = yield* EnvVarRepo;
    return yield* repo.list(filters);
  });

const deleteById = (id: string) =>
  Effect.gen(function* () {
    const repo = yield* EnvVarRepo;
    return yield* repo.deleteById({ id });
  });

const revision = (id: string): InsertParams["revision"] => ({
  id,
  valueCiphertext: `cipher-${id}`,
  wrappedDek: `dek-${id}`,
  vaultVersion: 1,
});

const globalInsert = (key: string, revisionId: string): InsertParams => ({
  organizationId: ORG_ID,
  projectId: null,
  scope: "global",
  environment: "production",
  key,
  visibility: "plaintext",
  createdByUserId: null,
  revision: revision(revisionId),
});

const countRevisions = (envVarId: string) =>
  env.DB.prepare(`SELECT COUNT(*) AS n FROM "env_var_revisions" WHERE "env_var_id" = ?`)
    .bind(envVarId)
    .first<{ n: number }>();

// ── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(ORG_ID, "Env Var Org", "env-var-org", "2026-01-01T00:00:00Z")
    .run();
  await env.DB.prepare(
    `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at") VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(PROJECT_ID, ORG_ID, "Env Var Project", "env-var-project", "2026-01-01T00:00:00Z")
    .run();
});

// ── Tests ─────────────────────────────────────────────────────────

describe("EnvVarRepo — D1 integration (Kysely + session)", () => {
  it("inserts an env var with its first revision atomically", async () => {
    const model = await run(insertWithRevision(globalInsert("API_URL", "rev-1")));

    expect(model).toMatchObject({
      organizationId: ORG_ID,
      projectId: null,
      scope: "global",
      environment: "production",
      key: "API_URL",
      visibility: "plaintext",
      currentRevisionId: "rev-1",
      revisionNumber: 1,
      revisionCount: 1,
    });

    const revisions = await countRevisions(model.id);
    expect(revisions?.n).toBe(1);
  });

  it("lists the inserted env var with its active revision metadata", async () => {
    const { items } = await run(
      list({ organizationId: ORG_ID, scope: "global", limit: 50, offset: 0 }),
    );

    const found = items.find((item) => item.key === "API_URL");
    expect(found).toBeDefined();
    expect(found).toMatchObject({ revisionNumber: 1, revisionCount: 1, scope: "global" });
  });

  it("fails with Conflict on a duplicate (scope, key, environment)", async () => {
    const result = await runEither(insertWithRevision(globalInsert("API_URL", "rev-dup")));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({
        _tag: "Conflict",
        message: `Variable "API_URL" already exists for this environment in this organization`,
      });
    }
  });

  it("appends a revision, advances the pointer, and bumps the count", async () => {
    const created = await run(insertWithRevision(globalInsert("TOKEN", "rev-a")));

    const updated = await run(
      addRevision({
        id: created.id,
        createdByUserId: null,
        visibility: "sensitive",
        revision: revision("rev-b"),
      }),
    );

    expect(updated).toMatchObject({
      currentRevisionId: "rev-b",
      revisionNumber: 2,
      revisionCount: 2,
      visibility: "sensitive",
    });
    const revisions = await countRevisions(created.id);
    expect(revisions?.n).toBe(2);
  });

  it("fails NotFound when adding a revision to a missing env var", async () => {
    const result = await runEither(
      addRevision({ id: "does-not-exist", createdByUserId: null, revision: revision("rev-x") }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: "NotFound" });
    }
  });

  it("deletes an env var and fails NotFound when it is absent", async () => {
    const created = await run(insertWithRevision(globalInsert("TO_DELETE", "rev-del")));

    await run(deleteById(created.id));

    const remaining = await env.DB.prepare(`SELECT "id" FROM "env_vars" WHERE "id" = ?`)
      .bind(created.id)
      .first<{ id: string }>();
    expect(remaining).toBeNull();

    const result = await runEither(deleteById(created.id));
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: "NotFound" });
    }
  });
});
