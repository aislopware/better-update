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

const insertBranch = (id: string, projectId: string) =>
  env.DB.prepare(
    `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, 'main', ?)`,
  )
    .bind(id, projectId, "2026-01-01T00:00:00Z")
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
            slug: "test-insert-1",
            createdAt: "2026-01-01T00:00:00Z",
          });
        }),
      );

      const row = await env.DB.prepare(`SELECT * FROM "projects" WHERE "id" = ?`)
        .bind("proj-insert-1")
        .first();

      expect(row).not.toBeNull();
      expect(row!.name).toBe("My App");
      expect(row!.slug).toBe("test-insert-1");
      expect(row!.organization_id).toBe("org-1");
      expect(row!.last_activity_at).toBe("2026-01-01T00:00:00Z");
    });

    it("returns Conflict on duplicate slug in same org", async () => {
      await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          yield* repo.insert({
            id: "proj-dup-1",
            organizationId: "org-1",
            name: "First",
            slug: "test-duplicate",
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
            slug: "test-duplicate",
            createdAt: "2026-01-02T00:00:00Z",
          });
        }),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toMatchObject({ _tag: "Conflict" });
      }
    });

    it("populates projects_fts on insert via trigger", async () => {
      await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          yield* repo.insert({
            id: "proj-fts-trigger",
            organizationId: "org-1",
            name: "Searchable Trigger Project",
            slug: "searchable-trigger",
            createdAt: "2026-01-01T00:00:00Z",
          });
        }),
      );

      const ftsRow = await env.DB.prepare(
        `SELECT "name", "slug" FROM "projects_fts" WHERE "project_id" = ?`,
      )
        .bind("proj-fts-trigger")
        .first();

      expect(ftsRow).not.toBeNull();
      expect(ftsRow!.name).toBe("Searchable Trigger Project");
      expect(ftsRow!.slug).toBe("searchable-trigger");
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
            slug: "org1-app-a",
            createdAt: "2026-01-01T00:00:00Z",
          });
          yield* repo.insert({
            id: "proj-find-2",
            organizationId: "org-1",
            name: "Org1 App B",
            slug: "org1-app-b",
            createdAt: "2026-01-02T00:00:00Z",
          });
          yield* repo.insert({
            id: "proj-find-3",
            organizationId: "org-1",
            name: "Org1 App C",
            slug: "org1-app-c",
            createdAt: "2026-01-03T00:00:00Z",
          });

          yield* repo.insert({
            id: "proj-find-4",
            organizationId: "org-2",
            name: "Org2 App",
            slug: "org2-app",
            createdAt: "2026-01-01T00:00:00Z",
          });
        }),
      );
    });

    it("returns only projects for the given org", async () => {
      const result = await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findByOrg({
            organizationId: "org-2",
            sort: "lastActivityAt",
            order: "desc",
            limit: 20,
            offset: 0,
          });
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
          return yield* repo.findByOrg({
            organizationId: "org-1",
            sort: "lastActivityAt",
            order: "desc",
            limit: 2,
            offset: 0,
          });
        }),
      );

      // total reflects ALL org-1 projects (insert test added more)
      expect(page1.total).toBeGreaterThanOrEqual(3);
      expect(page1.items).toHaveLength(2);

      const page2 = await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findByOrg({
            organizationId: "org-1",
            sort: "lastActivityAt",
            order: "desc",
            limit: 2,
            offset: 2,
          });
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
          return yield* repo.findByOrg({
            organizationId: "org-empty",
            sort: "lastActivityAt",
            order: "desc",
            limit: 20,
            offset: 0,
          });
        }),
      );

      expect(result.total).toBe(0);
      expect(result.items).toHaveLength(0);
    });

    it("sorts by name ascending (case-insensitive)", async () => {
      await insertOrg("org-sort", "org-sort");
      await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          yield* repo.insert({
            id: "sort-c",
            organizationId: "org-sort",
            name: "charlie",
            slug: "sort-charlie",
            createdAt: "2026-01-03T00:00:00Z",
          });
          yield* repo.insert({
            id: "sort-a",
            organizationId: "org-sort",
            name: "Alpha",
            slug: "sort-alpha",
            createdAt: "2026-01-01T00:00:00Z",
          });
          yield* repo.insert({
            id: "sort-b",
            organizationId: "org-sort",
            name: "bravo",
            slug: "sort-bravo",
            createdAt: "2026-01-02T00:00:00Z",
          });
        }),
      );

      const result = await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findByOrg({
            organizationId: "org-sort",
            sort: "name",
            order: "asc",
            limit: 20,
            offset: 0,
          });
        }),
      );

      expect(result.items.map((item) => item.name)).toEqual(["Alpha", "bravo", "charlie"]);
    });
  });

  describe("FTS substring search", () => {
    beforeAll(async () => {
      await insertOrg("org-fts", "org-fts");
      await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          yield* repo.insert({
            id: "fts-mobile",
            organizationId: "org-fts",
            name: "Mobile Banking",
            slug: "mobile-banking",
            createdAt: "2026-01-01T00:00:00Z",
          });
          yield* repo.insert({
            id: "fts-web",
            organizationId: "org-fts",
            name: "Web Dashboard",
            slug: "web-dashboard",
            createdAt: "2026-01-02T00:00:00Z",
          });
          yield* repo.insert({
            id: "fts-api",
            organizationId: "org-fts",
            name: "Public API",
            slug: "public-api",
            createdAt: "2026-01-03T00:00:00Z",
          });
        }),
      );
    });

    it("matches 3+ char substring via FTS5 trigram", async () => {
      const result = await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findByOrg({
            organizationId: "org-fts",
            query: "ban",
            sort: "lastActivityAt",
            order: "desc",
            limit: 20,
            offset: 0,
          });
        }),
      );

      expect(result.total).toBe(1);
      expect(result.items[0]?.id).toBe("fts-mobile");
    });

    it("matches by slug substring", async () => {
      const result = await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findByOrg({
            organizationId: "org-fts",
            query: "dashboard",
            sort: "lastActivityAt",
            order: "desc",
            limit: 20,
            offset: 0,
          });
        }),
      );

      expect(result.total).toBe(1);
      expect(result.items[0]?.id).toBe("fts-web");
    });

    it("falls back to LIKE for short queries (<3 chars)", async () => {
      const result = await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findByOrg({
            organizationId: "org-fts",
            query: "ap",
            sort: "name",
            order: "asc",
            limit: 20,
            offset: 0,
          });
        }),
      );

      // "ap" is contained in "Public API" (slug contains "api"), "public-api" (also "api")
      // Only Public API matches the "ap" substring
      expect(result.total).toBe(1);
      expect(result.items[0]?.id).toBe("fts-api");
    });

    it("respects org isolation in FTS results", async () => {
      const result = await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findByOrg({
            organizationId: "org-1",
            query: "Mobile",
            sort: "lastActivityAt",
            order: "desc",
            limit: 20,
            offset: 0,
          });
        }),
      );

      expect(result.total).toBe(0);
    });

    it("returns empty when no match", async () => {
      const result = await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findByOrg({
            organizationId: "org-fts",
            query: "doesnotexist",
            sort: "lastActivityAt",
            order: "desc",
            limit: 20,
            offset: 0,
          });
        }),
      );

      expect(result.total).toBe(0);
      expect(result.items).toHaveLength(0);
    });
  });

  describe("bumpLastActivity", () => {
    beforeAll(async () => {
      await insertOrg("org-bump", "org-bump");
      await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          yield* repo.insert({
            id: "bump-proj",
            organizationId: "org-bump",
            name: "Bump Project",
            slug: "bump-project",
            createdAt: "2026-01-01T00:00:00Z",
          });
        }),
      );
      await insertBranch("bump-branch", "bump-proj");
    });

    it("updates last_activity_at when newer", async () => {
      await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          yield* repo.bumpLastActivity({
            projectId: "bump-proj",
            at: "2026-02-01T00:00:00Z",
          });
        }),
      );

      const project = await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findById({ id: "bump-proj" });
        }),
      );
      expect(project.lastActivityAt).toBe("2026-02-01T00:00:00Z");
    });

    it("does not regress when older timestamp provided", async () => {
      await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          yield* repo.bumpLastActivity({
            projectId: "bump-proj",
            at: "2025-01-01T00:00:00Z",
          });
        }),
      );

      const project = await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findById({ id: "bump-proj" });
        }),
      );
      expect(project.lastActivityAt).toBe("2026-02-01T00:00:00Z");
    });

    it("bumpLastActivityByBranch resolves project via branch lookup", async () => {
      await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          yield* repo.bumpLastActivityByBranch({
            branchId: "bump-branch",
            at: "2026-03-01T00:00:00Z",
          });
        }),
      );

      const project = await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findById({ id: "bump-proj" });
        }),
      );
      expect(project.lastActivityAt).toBe("2026-03-01T00:00:00Z");
    });
  });

  describe("FTS sync via triggers", () => {
    it("removes project from projects_fts after delete", async () => {
      await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          yield* repo.insert({
            id: "delete-fts-proj",
            organizationId: "org-1",
            name: "Doomed Project",
            slug: "doomed-project",
            createdAt: "2026-01-01T00:00:00Z",
          });
          yield* repo.delete({ id: "delete-fts-proj" });
        }),
      );

      const ftsRow = await env.DB.prepare(
        `SELECT "project_id" FROM "projects_fts" WHERE "project_id" = ?`,
      )
        .bind("delete-fts-proj")
        .first();
      expect(ftsRow).toBeNull();
    });

    it("updates projects_fts when project is renamed", async () => {
      await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          yield* repo.insert({
            id: "rename-fts-proj",
            organizationId: "org-1",
            name: "Original Name",
            slug: "rename-fts",
            createdAt: "2026-01-01T00:00:00Z",
          });
          yield* repo.updateName({ id: "rename-fts-proj", name: "Updated Name" });
        }),
      );

      const ftsRow = await env.DB.prepare(
        `SELECT "name" FROM "projects_fts" WHERE "project_id" = ?`,
      )
        .bind("rename-fts-proj")
        .first();
      expect(ftsRow!.name).toBe("Updated Name");
    });
  });

  describe("archival", () => {
    beforeAll(async () => {
      await insertOrg("org-arch", "org-arch");
      await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          yield* repo.insert({
            id: "arch-active",
            organizationId: "org-arch",
            name: "Active App",
            slug: "arch-active",
            createdAt: "2026-01-01T00:00:00Z",
          });
          yield* repo.insert({
            id: "arch-archived",
            organizationId: "org-arch",
            name: "Archived App",
            slug: "arch-archived",
            createdAt: "2026-01-02T00:00:00Z",
          });
          yield* repo.setArchived({ id: "arch-archived", archivedAt: "2026-02-01T00:00:00Z" });
        }),
      );
    });

    it("new projects are active (archivedAt null); setArchived/findArchivedAt round-trip", async () => {
      const result = await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          const active = yield* repo.findArchivedAt({ id: "arch-active" });
          const archived = yield* repo.findArchivedAt({ id: "arch-archived" });
          const project = yield* repo.findById({ id: "arch-archived" });
          return { active, archived, projectArchivedAt: project.archivedAt };
        }),
      );

      expect(result.active).toBeNull();
      expect(result.archived).toBe("2026-02-01T00:00:00Z");
      expect(result.projectArchivedAt).toBe("2026-02-01T00:00:00Z");
    });

    it("findByOrg defaults to active-only (hides archived)", async () => {
      const result = await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findByOrg({
            organizationId: "org-arch",
            sort: "lastActivityAt",
            order: "desc",
            limit: 20,
            offset: 0,
          });
        }),
      );

      expect(result.total).toBe(1);
      expect(result.items.map((item) => item.id)).toEqual(["arch-active"]);
    });

    it("findByOrg status=archived returns only archived", async () => {
      const result = await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findByOrg({
            organizationId: "org-arch",
            status: "archived",
            sort: "lastActivityAt",
            order: "desc",
            limit: 20,
            offset: 0,
          });
        }),
      );

      expect(result.total).toBe(1);
      expect(result.items.map((item) => item.id)).toEqual(["arch-archived"]);
    });

    it("findByOrg status=all returns both active and archived", async () => {
      const result = await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findByOrg({
            organizationId: "org-arch",
            status: "all",
            sort: "lastActivityAt",
            order: "asc",
            limit: 20,
            offset: 0,
          });
        }),
      );

      expect(result.total).toBe(2);
      expect(result.items.map((item) => item.id).sort()).toEqual(["arch-active", "arch-archived"]);
    });

    it("unarchive (setArchived null) restores the project to active listings", async () => {
      await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          yield* repo.setArchived({ id: "arch-archived", archivedAt: null });
        }),
      );

      const result = await run(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          const archivedAt = yield* repo.findArchivedAt({ id: "arch-archived" });
          const active = yield* repo.findByOrg({
            organizationId: "org-arch",
            sort: "lastActivityAt",
            order: "desc",
            limit: 20,
            offset: 0,
          });
          return { archivedAt, activeTotal: active.total };
        }),
      );

      expect(result.archivedAt).toBeNull();
      expect(result.activeTotal).toBe(2);
    });
  });
});
