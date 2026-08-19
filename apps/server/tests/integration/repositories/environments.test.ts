import { env } from "cloudflare:workers";
import { Effect, Result } from "effect";

import { EnvironmentRepo, EnvironmentRepoLive } from "../../../src/repositories/environments";
import { runResultWithLayerAndEnv, runWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const run = async <Ret, Err>(effect: Effect.Effect<Ret, Err, EnvironmentRepo>) =>
  runWithLayerAndEnv(effect, EnvironmentRepoLive, env);

const runResult = async <Ret, Err>(effect: Effect.Effect<Ret, Err, EnvironmentRepo>) =>
  runResultWithLayerAndEnv(effect, EnvironmentRepoLive, env);

const insertOrg = async (id: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${id}`, id, "2026-01-01T00:00:00Z")
    .run();

const insertEnvironment = async (id: string, organizationId: string, name: string) =>
  env.DB.prepare(
    `INSERT INTO "environments" ("id", "organization_id", "name", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, organizationId, name, "2026-01-01T00:00:00Z")
    .run();

const insertGlobalVar = async (
  id: string,
  organizationId: string,
  key: string,
  environment: string,
) =>
  env.DB.prepare(
    `INSERT INTO "env_vars" ("id", "organization_id", "project_id", "scope", "environment", "key", "visibility") VALUES (?, ?, NULL, 'global', ?, ?, 'plaintext')`,
  )
    .bind(id, organizationId, environment, key)
    .run();

// ── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await insertOrg("env-list");
  await insertOrg("env-other");
  await insertOrg("env-life");
  await insertOrg("env-iconf");
  await insertOrg("env-count");
  await insertOrg("env-rename");
  await insertOrg("env-rconf");

  // listByOrg: case-insensitive ordering + org scoping.
  await insertEnvironment("e-list-1", "env-list", "Zeta");
  await insertEnvironment("e-list-2", "env-list", "alpha");
  await insertEnvironment("e-other-1", "env-other", "shadow");

  // insert Conflict (duplicate name within the org).
  await insertEnvironment("e-iconf-1", "env-iconf", "dup");

  // countEnvVarsUsing: two vars bound to "production", one to "preview".
  await insertGlobalVar("v-count-1", "env-count", "ALPHA", "production");
  await insertGlobalVar("v-count-2", "env-count", "BETA", "production");
  await insertGlobalVar("v-count-3", "env-count", "GAMMA", "preview");

  // rename success: an environment row + a var bound to the old name.
  await insertEnvironment("e-rename-1", "env-rename", "staging");
  await insertGlobalVar("v-rename-1", "env-rename", "API_URL", "staging");

  // rename Conflict: same key already exists at the target name.
  await insertEnvironment("e-rconf-1", "env-rconf", "staging");
  await insertGlobalVar("v-rconf-1", "env-rconf", "TOKEN", "staging");
  await insertGlobalVar("v-rconf-2", "env-rconf", "TOKEN", "qa");
});

// ── Tests ─────────────────────────────────────────────────────────

describe("EnvironmentRepo — D1 integration (Kysely + session)", () => {
  it("lists user-defined environments case-insensitively, scoped to the org", async () => {
    const rows = await run(
      Effect.gen(function* () {
        const repo = yield* EnvironmentRepo;
        return yield* repo.listByOrg({ organizationId: "env-list" });
      }),
    );

    expect(rows.map((row) => row.name)).toStrictEqual(["alpha", "Zeta"]);
    expect(rows.every((row) => row.organizationId === "env-list")).toBe(true);
  });

  it("inserts, reads back by name, then deletes an environment", async () => {
    const found = await run(
      Effect.gen(function* () {
        const repo = yield* EnvironmentRepo;
        yield* repo.insert({
          id: "e-life-1",
          organizationId: "env-life",
          name: "qa",
          createdAt: "2026-02-02T00:00:00Z",
        });
        return yield* repo.findByName({ organizationId: "env-life", name: "qa" });
      }),
    );
    expect(found).toStrictEqual({
      id: "e-life-1",
      organizationId: "env-life",
      name: "qa",
      createdAt: "2026-02-02T00:00:00Z",
    });

    const afterDelete = await runResult(
      Effect.gen(function* () {
        const repo = yield* EnvironmentRepo;
        yield* repo.deleteByName({ organizationId: "env-life", name: "qa" });
        return yield* repo.findByName({ organizationId: "env-life", name: "qa" });
      }),
    );
    expect(Result.isFailure(afterDelete)).toBe(true);
    if (Result.isFailure(afterDelete)) {
      expect(afterDelete.failure).toMatchObject({ _tag: "NotFound" });
    }
  });

  it("fails with Conflict when inserting a duplicate name in the same org", async () => {
    const result = await runResult(
      Effect.gen(function* () {
        const repo = yield* EnvironmentRepo;
        yield* repo.insert({
          id: "e-iconf-2",
          organizationId: "env-iconf",
          name: "dup",
          createdAt: "2026-02-02T00:00:00Z",
        });
      }),
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ _tag: "Conflict" });
    }
  });

  it("counts env vars (project + global) bound to an environment name", async () => {
    const count = await run(
      Effect.gen(function* () {
        const repo = yield* EnvironmentRepo;
        return yield* repo.countEnvVarsUsing({ organizationId: "env-count", name: "production" });
      }),
    );

    expect(count).toBe(2);
  });

  it("renames an environment and re-points every env var bound to the old name", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* EnvironmentRepo;
        yield* repo.rename({
          organizationId: "env-rename",
          oldName: "staging",
          newName: "released",
        });
      }),
    );

    const renamed = await env.DB.prepare(`SELECT "name" FROM "environments" WHERE "id" = ?`)
      .bind("e-rename-1")
      .first<{ name: string }>();
    expect(renamed).toStrictEqual({ name: "released" });

    const repointed = await env.DB.prepare(`SELECT "environment" FROM "env_vars" WHERE "id" = ?`)
      .bind("v-rename-1")
      .first<{ environment: string }>();
    expect(repointed).toStrictEqual({ environment: "released" });
  });

  it("fails with Conflict when the rename collides with an existing var key", async () => {
    const result = await runResult(
      Effect.gen(function* () {
        const repo = yield* EnvironmentRepo;
        yield* repo.rename({ organizationId: "env-rconf", oldName: "staging", newName: "qa" });
      }),
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ _tag: "Conflict" });
    }
  });
});
