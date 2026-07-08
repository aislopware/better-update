import { env } from "cloudflare:test";
import { Effect } from "effect";

import { decodeCursor } from "../../../src/lib/cursor";
import { AuditLogRepo, AuditLogRepoLive } from "../../../src/repositories/audit-logs";
import { runWithLayerAndEnv } from "../../helpers/runtime";

import type { Cursor } from "../../../src/lib/cursor";
import type { AuditLogResourceType } from "../../../src/models";

// ── Helpers ───────────────────────────────────────────────────────

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, AuditLogRepo>) =>
  runWithLayerAndEnv(effect, AuditLogRepoLive, env);

const insertOrg = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${id}`, `${id}-slug`, "2024-01-01T00:00:00Z")
    .run();

const insertLog = (params: {
  readonly id: string;
  readonly createdAt: string;
  readonly projectId?: string | null;
  readonly resourceType?: string;
}) =>
  env.DB.prepare(
    `INSERT INTO "audit_logs" ("id", "organization_id", "project_id", "actor_id", "actor_email", "action", "resource_type", "resource_id", "metadata", "source", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      params.id,
      "org-audit",
      params.projectId ?? null,
      null,
      "actor@example.com",
      "resource.created",
      params.resourceType ?? "project",
      null,
      null,
      "session",
      params.createdAt,
    )
    .run();

const list = (params: {
  readonly projectId?: string;
  readonly resourceTypes?: readonly AuditLogResourceType[];
  readonly from?: string;
  readonly to?: string;
  readonly cursor?: Cursor | null;
  readonly limit?: number;
}) =>
  run(
    Effect.gen(function* () {
      const repo = yield* AuditLogRepo;
      return yield* repo.list({
        organizationId: "org-audit",
        ...params,
        cursor: params.cursor ?? null,
        limit: params.limit ?? 50,
      });
    }),
  );

// ── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await insertOrg("org-audit");
  // Distinct timestamps so the (created_at DESC, id DESC) order is deterministic.
  await insertLog({ id: "log-1", createdAt: "2026-01-01T00:00:00.000Z" });
  await insertLog({ id: "log-2", createdAt: "2026-01-02T00:00:00.000Z", projectId: "proj-x" });
  await insertLog({
    id: "log-3",
    createdAt: "2026-01-03T00:00:00.000Z",
    resourceType: "build",
  });
  await insertLog({ id: "log-4", createdAt: "2026-01-04T00:00:00.000Z" });
});

// ── Tests ─────────────────────────────────────────────────────────

describe("AuditLogRepo — D1 integration (Kysely + session)", () => {
  it("lists newest-first by created_at then id, mapping to the model", async () => {
    const page = await list({});

    expect(page.items.map((item) => item.id)).toEqual(["log-4", "log-3", "log-2", "log-1"]);
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toMatchObject({
      organizationId: "org-audit",
      actorEmail: "actor@example.com",
      action: "resource.created",
      source: "session",
    });
  });

  it("paginates via the cursor, returning the remainder on the next page", async () => {
    const first = await list({ limit: 2 });

    expect(first.items.map((item) => item.id)).toEqual(["log-4", "log-3"]);
    expect(first.nextCursor).not.toBeNull();

    const cursor = first.nextCursor ? decodeCursor(first.nextCursor) : null;
    const second = await list({ cursor, limit: 2 });

    expect(second.items.map((item) => item.id)).toEqual(["log-2", "log-1"]);
    expect(second.nextCursor).toBeNull();
  });

  it("filters by projectId and resource types (multi-value IN)", async () => {
    const byProject = await list({ projectId: "proj-x" });
    expect(byProject.items.map((item) => item.id)).toEqual(["log-2"]);

    const byResource = await list({ resourceTypes: ["build"] });
    expect(byResource.items.map((item) => item.id)).toEqual(["log-3"]);

    const byResources = await list({ resourceTypes: ["build", "project"] });
    expect(byResources.items.map((item) => item.id)).toEqual(["log-4", "log-3", "log-2", "log-1"]);
  });

  it("filters by the created_at from/to window", async () => {
    const windowed = await list({
      from: "2026-01-02T00:00:00.000Z",
      to: "2026-01-03T00:00:00.000Z",
    });

    expect(windowed.items.map((item) => item.id)).toEqual(["log-3", "log-2"]);
  });

  it("insert persists a row that list then returns", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* AuditLogRepo;
        yield* repo.insert({
          id: "log-inserted",
          organizationId: "org-audit",
          projectId: null,
          actorId: null,
          actorEmail: "writer@example.com",
          action: "thing.deleted",
          resourceType: "channel",
          resourceId: "chan-1",
          metadata: null,
          // 'robot' regression-tests the 0085 CHECK widening: robot actors are
          // the one live source the original 0008 constraint rejected.
          source: "robot",
        });
      }),
    );

    // created_at falls back to the DB default (wall clock), so locate by id
    // rather than a timestamp window.
    const page = await list({ limit: 100 });
    const inserted = page.items.find((item) => item.id === "log-inserted");

    expect(inserted).toMatchObject({
      id: "log-inserted",
      actorEmail: "writer@example.com",
      action: "thing.deleted",
      resourceType: "channel",
      resourceId: "chan-1",
      source: "robot",
    });
  });
});
