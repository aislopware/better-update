import { Effect, Either, Exit } from "effect";

import { mockD1 } from "../../tests/helpers/mock-d1";
import { runEitherWithLayerAndEnv, runWithLayerAndEnvExit } from "../../tests/helpers/runtime";
import { ProjectRepo, ProjectRepoLive } from "./projects";

const makeInsertParams = () => ({
  id: "proj-1",
  organizationId: "org-1",
  name: "My App",
  slug: "my-app",
  createdAt: "2026-01-01T00:00:00Z",
});

const makeEnv = (db: unknown) => ({ DB: db }) as unknown as Env;

const runWithRepo = async <Ret, Err>(effect: Effect.Effect<Ret, Err, ProjectRepo>, env: Env) =>
  runWithLayerAndEnvExit(effect, ProjectRepoLive, env);

const runWithRepoEither = async <Ret, Err>(
  effect: Effect.Effect<Ret, Err, ProjectRepo>,
  env: Env,
) => runEitherWithLayerAndEnv(effect, ProjectRepoLive, env);

// ── Tests ─────────────────────────────────────────────────────────

describe("projectRepo — D1 adapter", () => {
  describe("insert", () => {
    it("succeeds on valid insert", async () => {
      const db = mockD1.forRun(async () => ({ results: [], success: true }));
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          yield* repo.insert(makeInsertParams());
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    });

    it("returns Conflict on UNIQUE constraint violation", async () => {
      const db = mockD1.forRun(() => {
        throw new Error("UNIQUE constraint failed: projects.slug");
      });
      const env = makeEnv(db);

      const result = await runWithRepoEither(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          yield* repo.insert(makeInsertParams());
        }),
        env,
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toMatchObject({ _tag: "Conflict" });
      }
    });
  });

  describe("findByOrg", () => {
    it("returns items and total count", async () => {
      const db = mockD1.forQuery({
        first: async () => ({ count: 2 }),
        all: async () => ({
          results: [
            {
              id: "p1",
              organization_id: "org-1",
              name: "App One",
              slug: "scope-one",
              created_at: "2026-01-01T00:00:00Z",
              last_activity_at: "2026-01-01T00:00:00Z",
            },
            {
              id: "p2",
              organization_id: "org-1",
              name: "App Two",
              slug: "scope-two",
              created_at: "2026-01-02T00:00:00Z",
              last_activity_at: "2026-01-02T00:00:00Z",
            },
          ],
        }),
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findByOrg({
            organizationId: "org-1",
            sort: "lastActivityAt",
            order: "desc",
            limit: 20,
            offset: 0,
          });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const result = exit.value;
        expect(result.total).toBe(2);
        expect(result.items).toHaveLength(2);
        expect(result.items[0]).toStrictEqual(expect.objectContaining({ name: "App One" }));
      }
    });

    it("returns empty items when no projects exist", async () => {
      const db = mockD1.forQuery({
        first: async () => ({ count: 0 }),
        all: async () => ({ results: [] }),
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findByOrg({
            organizationId: "org-1",
            sort: "lastActivityAt",
            order: "desc",
            limit: 20,
            offset: 0,
          });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.total).toBe(0);
        expect(exit.value.items).toHaveLength(0);
      }
    });
  });

  describe("findById", () => {
    it("returns project when found", async () => {
      const db = mockD1.forQuery({
        first: async () => ({
          id: "p1",
          organization_id: "org-1",
          name: "App One",
          slug: "scope-one",
          created_at: "2026-01-01T00:00:00Z",
        }),
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findById({ id: "p1" });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value).toStrictEqual(expect.objectContaining({ name: "App One" }));
      }
    });

    it("returns NotFound when not found", async () => {
      const db = mockD1.forQuery({
        first: async () => null,
      });
      const env = makeEnv(db);

      const result = await runWithRepoEither(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findById({ id: "nonexistent" });
        }),
        env,
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toMatchObject({ _tag: "NotFound" });
      }
    });
  });

  describe("findOrgIdById", () => {
    it("returns organization ID when project exists", async () => {
      const db = mockD1.forQuery({
        first: async () => ({ organization_id: "org-1" }),
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findOrgIdById({ id: "p1" });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value).toBe("org-1");
      }
    });

    it("returns NotFound when project does not exist", async () => {
      const db = mockD1.forQuery({
        first: async () => null,
      });
      const env = makeEnv(db);

      const result = await runWithRepoEither(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findOrgIdById({ id: "nonexistent" });
        }),
        env,
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toMatchObject({ _tag: "NotFound" });
      }
    });
  });
});
