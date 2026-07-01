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

const upsertDescription = (params: Parameters<EnvVarRepo["Type"]["upsertDescription"]>[0]) =>
  Effect.gen(function* () {
    const repo = yield* EnvVarRepo;
    return yield* repo.upsertDescription(params);
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

  it("shares label/description across a variable's environments", async () => {
    await run(
      insertWithRevision({ ...globalInsert("DOC_KEY", "doc-prod"), environment: "production" }),
    );
    await run(
      insertWithRevision({ ...globalInsert("DOC_KEY", "doc-dev"), environment: "development" }),
    );

    const saved = await run(
      upsertDescription({
        organizationId: ORG_ID,
        scope: "global",
        projectId: null,
        key: "DOC_KEY",
        label: "Docs key",
        description: "What it does",
      }),
    );
    expect(saved).toMatchObject({ label: "Docs key", description: "What it does" });

    // The documentation is keyed by (scope, key), so it joins onto BOTH the
    // production and development rows of the same variable.
    const { items } = await run(
      list({ organizationId: ORG_ID, scope: "global", limit: 50, offset: 0 }),
    );
    const rows = items.filter((item) => item.key === "DOC_KEY");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.label).toBe("Docs key");
      expect(row.description).toBe("What it does");
    }
  });

  it("merges partial documentation updates (undefined keeps, null clears)", async () => {
    await run(
      upsertDescription({
        organizationId: ORG_ID,
        scope: "global",
        projectId: null,
        key: "DOC_KEY",
        label: "Seed label",
        description: "Seed description",
      }),
    );

    // Omitting `label` leaves it; passing `description` overwrites just that field.
    const afterDescOnly = await run(
      upsertDescription({
        organizationId: ORG_ID,
        scope: "global",
        projectId: null,
        key: "DOC_KEY",
        description: "New description",
      }),
    );
    expect(afterDescOnly).toMatchObject({ label: "Seed label", description: "New description" });

    // Passing null clears a field.
    const afterClear = await run(
      upsertDescription({
        organizationId: ORG_ID,
        scope: "global",
        projectId: null,
        key: "DOC_KEY",
        label: null,
      }),
    );
    expect(afterClear).toMatchObject({ label: null, description: "New description" });
  });

  it("keeps project and global documentation for the same key separate", async () => {
    await run(insertWithRevision(globalInsert("SHARED_KEY", "shared-global")));
    await run(
      insertWithRevision({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        scope: "project",
        environment: "production",
        key: "SHARED_KEY",
        visibility: "plaintext",
        createdByUserId: null,
        revision: revision("shared-project"),
      }),
    );

    await run(
      upsertDescription({
        organizationId: ORG_ID,
        scope: "global",
        projectId: null,
        key: "SHARED_KEY",
        label: "Global label",
      }),
    );
    await run(
      upsertDescription({
        organizationId: ORG_ID,
        scope: "project",
        projectId: PROJECT_ID,
        key: "SHARED_KEY",
        label: "Project label",
      }),
    );

    const { items } = await run(
      list({ organizationId: ORG_ID, projectId: PROJECT_ID, scope: "all", limit: 50, offset: 0 }),
    );
    const globalRow = items.find((item) => item.key === "SHARED_KEY" && item.scope === "global");
    const projectRow = items.find((item) => item.key === "SHARED_KEY" && item.scope === "project");
    expect(globalRow?.label).toBe("Global label");
    expect(projectRow?.label).toBe("Project label");
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
