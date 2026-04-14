import { env } from "cloudflare:test";
import { Effect, Either } from "effect";

import { ProjectRepo, ProjectRepoLive } from "../../../src/repositories/projects";
import { runEitherWithLayerAndEnv, runWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, ProjectRepo>) =>
  runWithLayerAndEnv(effect, ProjectRepoLive, env);

const runEither = <Ret, Err>(effect: Effect.Effect<Ret, Err, ProjectRepo>) =>
  runEitherWithLayerAndEnv(effect, ProjectRepoLive, env);

const insertOrg = (id: string, slug: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${slug}`, slug, "2026-01-01T00:00:00Z")
    .run();

// ── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await insertOrg("org-1", "org-one");
  await insertOrg("org-2", "org-two");
});

// ── Tests ─────────────────────────────────────────────────────────

describe("ProjectRepo — D1 integration", () => {
  describe("insert", () => {
    it("persists a project to D1", async () => {
      await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          yield* repo.insert({
            id: "proj-insert-1",
            organizationId: "org-1",
            name: "My App",
            scopeKey: "@test/insert-1",
            createdAt: "2026-01-01T00:00:00Z",
          });
        }),
      );

      const row = await env.DB.prepare(`SELECT * FROM "projects" WHERE "id" = ?`)
        .bind("proj-insert-1")
        .first();

      expect(row).not.toBeNull();
      expect(row!.name).toBe("My App");
      expect(row!.scope_key).toBe("@test/insert-1");
      expect(row!.organization_id).toBe("org-1");
    });

    it("returns Conflict on duplicate scope_key", async () => {
      await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          yield* repo.insert({
            id: "proj-dup-1",
            organizationId: "org-1",
            name: "First",
            scopeKey: "@test/duplicate",
            createdAt: "2026-01-01T00:00:00Z",
          });
        }),
      );

      const result = await runEither(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          yield* repo.insert({
            id: "proj-dup-2",
            organizationId: "org-1",
            name: "Second",
            scopeKey: "@test/duplicate",
            createdAt: "2026-01-02T00:00:00Z",
          });
        }),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toMatchObject({ _tag: "Conflict" });
      }
    });
  });

  describe("findByOrg", () => {
    beforeAll(async () => {
      // Seed projects for both orgs
      await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;

          yield* repo.insert({
            id: "proj-find-1",
            organizationId: "org-1",
            name: "Org1 App A",
            scopeKey: "@org1/app-a",
            createdAt: "2026-01-01T00:00:00Z",
          });
          yield* repo.insert({
            id: "proj-find-2",
            organizationId: "org-1",
            name: "Org1 App B",
            scopeKey: "@org1/app-b",
            createdAt: "2026-01-02T00:00:00Z",
          });
          yield* repo.insert({
            id: "proj-find-3",
            organizationId: "org-1",
            name: "Org1 App C",
            scopeKey: "@org1/app-c",
            createdAt: "2026-01-03T00:00:00Z",
          });

          yield* repo.insert({
            id: "proj-find-4",
            organizationId: "org-2",
            name: "Org2 App",
            scopeKey: "@org2/app",
            createdAt: "2026-01-01T00:00:00Z",
          });
        }),
      );
    });

    it("returns only projects for the given org", async () => {
      const result = await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findByOrg({ organizationId: "org-2", limit: 20, offset: 0 });
        }),
      );

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(expect.objectContaining({ name: "Org2 App" }));
    });

    it("paginates with limit and offset", async () => {
      const page1 = await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findByOrg({ organizationId: "org-1", limit: 2, offset: 0 });
        }),
      );

      // total reflects ALL org-1 projects (insert test added more)
      expect(page1.total).toBeGreaterThanOrEqual(3);
      expect(page1.items).toHaveLength(2);

      const page2 = await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findByOrg({ organizationId: "org-1", limit: 2, offset: 2 });
        }),
      );

      expect(page2.items.length).toBeGreaterThanOrEqual(1);

      // No overlap between pages
      const page1Ids = page1.items.map((item) => item.id);
      const page2Ids = page2.items.map((item) => item.id);
      const overlap = page1Ids.filter((id) => page2Ids.includes(id));
      expect(overlap).toHaveLength(0);
    });

    it("returns empty for org with no projects", async () => {
      await insertOrg("org-empty", "org-empty");

      const result = await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findByOrg({ organizationId: "org-empty", limit: 20, offset: 0 });
        }),
      );

      expect(result.total).toBe(0);
      expect(result.items).toHaveLength(0);
    });
  });
});
