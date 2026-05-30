import { env } from "cloudflare:test";
import { Effect } from "effect";

import {
  ProjectProtocolMetadataRepo,
  ProjectProtocolMetadataRepoLive,
} from "../../../src/repositories/project-protocol-metadata";
import { runWithLayerAndEnv } from "../../helpers/runtime";

// Real D1 round-trip for the per-(project, scopeKey) protocol metadata store via
// @cloudflare/vitest-pool-workers. Proves full-replace semantics, per-scope
// isolation, and the (project_id, scope_key) single-row guarantee.

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, ProjectProtocolMetadataRepo>) =>
  runWithLayerAndEnv(effect, ProjectProtocolMetadataRepoLive, env);

const insertProject = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, 'PPM Org', ?, '2026-01-01T00:00:00Z')`,
  )
    .bind(`org-${id}`, `org-${id}`)
    .run()
    .then(() =>
      env.DB.prepare(
        `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at") VALUES (?, ?, 'PPM Project', ?, '2026-01-01T00:00:00Z')`,
      )
        .bind(id, `org-${id}`, `slug-${id}`)
        .run(),
    );

describe("ProjectProtocolMetadataRepo — D1 integration", () => {
  it("get returns null when no row exists for (projectId, scopeKey)", async () => {
    const projectId = `ppm-empty-${crypto.randomUUID().slice(0, 8)}`;
    await insertProject(projectId);

    const row = await run(
      Effect.gen(function* () {
        const repo = yield* ProjectProtocolMetadataRepo;
        return yield* repo.get({ projectId, scopeKey: "https://a.example" });
      }),
    );

    expect(row).toBeNull();
  });

  it("upsertServerDefinedHeaders then get returns the stored JSON for that scope", async () => {
    const projectId = `ppm-roundtrip-${crypto.randomUUID().slice(0, 8)}`;
    await insertProject(projectId);
    const scopeKey = "https://updates.better-update.dev";
    const json = JSON.stringify({ "expo-extra-params": 'foo="bar"' });

    const row = await run(
      Effect.gen(function* () {
        const repo = yield* ProjectProtocolMetadataRepo;
        yield* repo.upsertServerDefinedHeaders({
          projectId,
          scopeKey,
          serverDefinedHeadersJson: json,
        });
        return yield* repo.get({ projectId, scopeKey });
      }),
    );

    expect(row?.server_defined_headers_json).toBe(json);
    expect(row?.manifest_filters_json).toBeNull();
  });

  it("a second upsert REPLACES (full-replace, not merge) and keeps exactly one row", async () => {
    const projectId = `ppm-replace-${crypto.randomUUID().slice(0, 8)}`;
    await insertProject(projectId);
    const scopeKey = "https://updates.better-update.dev";

    const row = await run(
      Effect.gen(function* () {
        const repo = yield* ProjectProtocolMetadataRepo;
        yield* repo.upsertServerDefinedHeaders({
          projectId,
          scopeKey,
          serverDefinedHeadersJson: JSON.stringify({ a: 1 }),
        });
        yield* repo.upsertServerDefinedHeaders({
          projectId,
          scopeKey,
          serverDefinedHeadersJson: JSON.stringify({ b: 2 }),
        });
        return yield* repo.get({ projectId, scopeKey });
      }),
    );

    expect(row?.server_defined_headers_json).toBe(JSON.stringify({ b: 2 }));

    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM "project_protocol_metadata" WHERE "project_id" = ?`,
    )
      .bind(projectId)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("can clear the stored headers by upserting NULL (clear semantics)", async () => {
    const projectId = `ppm-clear-${crypto.randomUUID().slice(0, 8)}`;
    await insertProject(projectId);
    const scopeKey = "https://updates.better-update.dev";

    const row = await run(
      Effect.gen(function* () {
        const repo = yield* ProjectProtocolMetadataRepo;
        yield* repo.upsertServerDefinedHeaders({
          projectId,
          scopeKey,
          serverDefinedHeadersJson: JSON.stringify({ a: 1 }),
        });
        yield* repo.upsertServerDefinedHeaders({
          projectId,
          scopeKey,
          serverDefinedHeadersJson: null,
        });
        return yield* repo.get({ projectId, scopeKey });
      }),
    );

    expect(row?.server_defined_headers_json).toBeNull();
  });

  it("isolates state per scopeKey on the same projectId", async () => {
    const projectId = `ppm-isolate-${crypto.randomUUID().slice(0, 8)}`;
    await insertProject(projectId);

    const result = await run(
      Effect.gen(function* () {
        const repo = yield* ProjectProtocolMetadataRepo;
        yield* repo.upsertServerDefinedHeaders({
          projectId,
          scopeKey: "https://a.example",
          serverDefinedHeadersJson: JSON.stringify({ scope: "a" }),
        });
        const a = yield* repo.get({ projectId, scopeKey: "https://a.example" });
        const b = yield* repo.get({ projectId, scopeKey: "https://b.example" });
        return { a, b };
      }),
    );

    expect(result.a?.server_defined_headers_json).toBe(JSON.stringify({ scope: "a" }));
    // A different scopeKey on the SAME project never reads A's state.
    expect(result.b).toBeNull();
  });

  it("upsertManifestFilters writes the filters column without clobbering headers (P1 sibling)", async () => {
    const projectId = `ppm-filters-${crypto.randomUUID().slice(0, 8)}`;
    await insertProject(projectId);
    const scopeKey = "https://updates.better-update.dev";

    const row = await run(
      Effect.gen(function* () {
        const repo = yield* ProjectProtocolMetadataRepo;
        yield* repo.upsertServerDefinedHeaders({
          projectId,
          scopeKey,
          serverDefinedHeadersJson: JSON.stringify({ a: 1 }),
        });
        yield* repo.upsertManifestFilters({
          projectId,
          scopeKey,
          manifestFiltersJson: JSON.stringify({ branchname: "rollout" }),
        });
        return yield* repo.get({ projectId, scopeKey });
      }),
    );

    expect(row?.server_defined_headers_json).toBe(JSON.stringify({ a: 1 }));
    expect(row?.manifest_filters_json).toBe(JSON.stringify({ branchname: "rollout" }));
  });
});
