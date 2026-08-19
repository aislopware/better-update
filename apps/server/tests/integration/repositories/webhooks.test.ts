import { env } from "cloudflare:workers";
import { Effect, Result } from "effect";

import { WebhookRepo, WebhookRepoLive } from "../../../src/repositories/webhooks";
import { runResultWithLayerAndEnv, runWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const run = async <Ret, Err>(effect: Effect.Effect<Ret, Err, WebhookRepo>) =>
  runWithLayerAndEnv(effect, WebhookRepoLive, env);

const runResult = async <Ret, Err>(effect: Effect.Effect<Ret, Err, WebhookRepo>) =>
  runResultWithLayerAndEnv(effect, WebhookRepoLive, env);

const insertWebhook = async (
  id: string,
  orgId: string,
  opts?: { enabled?: number; events?: string },
) =>
  env.DB.prepare(
    `INSERT INTO "webhooks" ("id", "organization_id", "project_id", "name", "url", "secret", "events", "enabled", "created_at", "updated_at") VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      orgId,
      `Webhook ${id}`,
      `https://example.com/${id}`,
      "secret-abc",
      opts?.events ?? JSON.stringify(["update.published"]),
      opts?.enabled ?? 1,
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
    )
    .run();

// ── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind("wh-org", "Webhook Org", "wh-org", "2026-01-01T00:00:00Z")
    .run();
  await insertWebhook("wh-1", "wh-org");
  await insertWebhook("wh-2", "wh-org", { enabled: 0 });
});

// ── Tests ─────────────────────────────────────────────────────────

describe("WebhookRepo — D1 integration (Kysely + session)", () => {
  it("inserts a webhook and the row is persisted", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* WebhookRepo;
        yield* repo.insert({
          id: "wh-inserted",
          organizationId: "wh-org",
          projectId: null,
          name: "Inserted Hook",
          url: "https://example.com/inserted",
          secret: "s",
          events: ["build.finished"],
          enabled: true,
          createdAt: "2026-02-01T00:00:00Z",
          updatedAt: "2026-02-01T00:00:00Z",
        });
      }),
    );
    const row = await env.DB.prepare(`SELECT "id" FROM "webhooks" WHERE "id" = ?`)
      .bind("wh-inserted")
      .first<{ id: string }>();
    expect(row).toMatchObject({ id: "wh-inserted" });
  });

  it("listByOrg returns all webhooks for the org", async () => {
    const list = await run(
      Effect.gen(function* () {
        const repo = yield* WebhookRepo;
        return yield* repo.listByOrg({ organizationId: "wh-org" });
      }),
    );
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.every((webhook) => webhook.organizationId === "wh-org")).toBe(true);
  });

  it("findById returns the mapped model", async () => {
    const webhook = await run(
      Effect.gen(function* () {
        const repo = yield* WebhookRepo;
        return yield* repo.findById({ id: "wh-1" });
      }),
    );
    expect(webhook).toMatchObject({
      id: "wh-1",
      organizationId: "wh-org",
      enabled: true,
      events: ["update.published"],
    });
  });

  it("findById fails with NotFound for an unknown id", async () => {
    const result = await runResult(
      Effect.gen(function* () {
        const repo = yield* WebhookRepo;
        return yield* repo.findById({ id: "wh-missing" });
      }),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ _tag: "NotFound" });
    }
  });

  it("update patches fields and returns the updated model", async () => {
    const updated = await run(
      Effect.gen(function* () {
        const repo = yield* WebhookRepo;
        return yield* repo.update({
          id: "wh-1",
          name: "Renamed Hook",
          enabled: false,
          updatedAt: "2026-03-01T00:00:00Z",
        });
      }),
    );
    expect(updated).toMatchObject({ id: "wh-1", name: "Renamed Hook", enabled: false });
  });

  it("delete removes the row and returns the deleted count", async () => {
    const result = await run(
      Effect.gen(function* () {
        const repo = yield* WebhookRepo;
        return yield* repo.delete({ id: "wh-2", organizationId: "wh-org" });
      }),
    );
    expect(result).toStrictEqual({ deleted: 1 });
    const row = await env.DB.prepare(`SELECT "id" FROM "webhooks" WHERE "id" = ?`)
      .bind("wh-2")
      .first();
    expect(row).toBeNull();
  });
});
