import { Effect, Either, Exit } from "effect";

import { runEitherWithLayerAndEnv, runWithLayerAndEnvExit } from "../../tests/helpers/runtime";
import { ProjectRepo, ProjectRepoLive } from "./projects";

// ── Mock D1 helpers ───────────────────────────────────────────────

const mockD1 = {
  forRun: (fn: () => Promise<unknown>) => ({
    prepare: () => ({ bind: () => ({ run: fn }) }),
  }),

  forQuery: (opts: { first?: () => Promise<unknown>; all?: () => Promise<unknown> }) => ({
    prepare: () => ({
      bind: () => ({
        first: opts.first ?? (async () => null),
        all: opts.all ?? (async () => ({ results: [] })),
      }),
    }),
  }),
};

const makeInsertParams = () => ({
  id: "proj-1",
  organizationId: "org-1",
  name: "My App",
  scopeKey: "@my/app",
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

describe("ProjectRepo — D1 adapter", () => {
  describe("insert", () => {
    test("succeeds on valid insert", async () => {
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

    test("returns Conflict on UNIQUE constraint violation", async () => {
      const db = mockD1.forRun(() => {
        throw new Error("UNIQUE constraint failed: projects.scope_key");
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
    test("returns items and total count", async () => {
      const db = mockD1.forQuery({
        first: async () => ({ count: 2 }),
        all: async () => ({
          results: [
            {
              id: "p1",
              organization_id: "org-1",
              name: "App One",
              scope_key: "@scope/one",
              created_at: "2026-01-01T00:00:00Z",
            },
            {
              id: "p2",
              organization_id: "org-1",
              name: "App Two",
              scope_key: "@scope/two",
              created_at: "2026-01-02T00:00:00Z",
            },
          ],
        }),
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findByOrg({ organizationId: "org-1", limit: 20, offset: 0 });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const result = exit.value;
        expect(result.total).toBe(2);
        expect(result.items).toHaveLength(2);
        expect(result.items[0]).toEqual(expect.objectContaining({ name: "App One" }));
      }
    });

    test("returns empty items when no projects exist", async () => {
      const db = mockD1.forQuery({
        first: async () => ({ count: 0 }),
        all: async () => ({ results: [] }),
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* ProjectRepo;
          return yield* repo.findByOrg({ organizationId: "org-1", limit: 20, offset: 0 });
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
    test("returns project when found", async () => {
      const db = mockD1.forQuery({
        first: async () => ({
          id: "p1",
          organization_id: "org-1",
          name: "App One",
          scope_key: "@scope/one",
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
        expect(exit.value).toEqual(expect.objectContaining({ name: "App One" }));
      }
    });

    test("returns NotFound when not found", async () => {
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
    test("returns organization ID when project exists", async () => {
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

    test("returns NotFound when project does not exist", async () => {
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
