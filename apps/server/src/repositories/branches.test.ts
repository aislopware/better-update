import { Effect, Either, Exit } from "effect";

import { runEitherWithLayerAndEnv, runWithLayerAndEnvExit } from "../../tests/helpers/runtime";
import { BranchRepo, BranchRepoLive } from "./branches";

// -- Mock D1 helpers -------------------------------------------------------

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
  id: "branch-1",
  projectId: "proj-1",
  name: "production",
  createdAt: "2026-01-01T00:00:00Z",
});

const makeEnv = (db: unknown) => ({ DB: db }) as unknown as Env;

const runWithRepo = async <Ret, Err>(effect: Effect.Effect<Ret, Err, BranchRepo>, env: Env) =>
  runWithLayerAndEnvExit(effect, BranchRepoLive, env);

const runWithRepoEither = async <Ret, Err>(effect: Effect.Effect<Ret, Err, BranchRepo>, env: Env) =>
  runEitherWithLayerAndEnv(effect, BranchRepoLive, env);

// -- Tests -----------------------------------------------------------------

describe("BranchRepo -- D1 adapter", () => {
  describe("insert", () => {
    test("succeeds on valid insert", async () => {
      const db = mockD1.forRun(async () => ({ results: [], success: true }));
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* BranchRepo;
          yield* repo.insert(makeInsertParams());
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    });

    test("returns Conflict on UNIQUE constraint violation", async () => {
      const db = mockD1.forRun(() => {
        throw new Error("UNIQUE constraint failed: branches.name");
      });
      const env = makeEnv(db);

      const result = await runWithRepoEither(
        Effect.gen(function* () {
          const repo = yield* BranchRepo;
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

  describe("findByProject", () => {
    test("returns items and total count", async () => {
      const db = mockD1.forQuery({
        first: async () => ({ count: 2 }),
        all: async () => ({
          results: [
            {
              id: "b1",
              project_id: "proj-1",
              name: "production",
              created_at: "2026-01-01T00:00:00Z",
            },
            {
              id: "b2",
              project_id: "proj-1",
              name: "staging",
              created_at: "2026-01-02T00:00:00Z",
            },
          ],
        }),
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* BranchRepo;
          return yield* repo.findByProject({ projectId: "proj-1", limit: 20, offset: 0 });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const result = exit.value;
        expect(result.total).toBe(2);
        expect(result.items).toHaveLength(2);
        expect(result.items[0]).toEqual(expect.objectContaining({ name: "production" }));
      }
    });

    test("returns empty items when no branches exist", async () => {
      const db = mockD1.forQuery({
        first: async () => ({ count: 0 }),
        all: async () => ({ results: [] }),
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* BranchRepo;
          return yield* repo.findByProject({ projectId: "proj-1", limit: 20, offset: 0 });
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
    test("returns branch when found", async () => {
      const db = mockD1.forQuery({
        first: async () => ({
          id: "b1",
          project_id: "proj-1",
          name: "production",
          created_at: "2026-01-01T00:00:00Z",
        }),
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* BranchRepo;
          return yield* repo.findById({ id: "b1" });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value).toEqual(expect.objectContaining({ name: "production" }));
      }
    });

    test("returns NotFound when not found", async () => {
      const db = mockD1.forQuery({
        first: async () => null,
      });
      const env = makeEnv(db);

      const result = await runWithRepoEither(
        Effect.gen(function* () {
          const repo = yield* BranchRepo;
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

  describe("updateName", () => {
    test("succeeds on valid update", async () => {
      const db = mockD1.forRun(async () => ({ results: [], success: true }));
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* BranchRepo;
          yield* repo.updateName({ id: "branch-1", name: "staging" });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    });

    test("returns Conflict on UNIQUE constraint violation", async () => {
      const db = mockD1.forRun(() => {
        throw new Error("UNIQUE constraint failed: branches.name");
      });
      const env = makeEnv(db);

      const result = await runWithRepoEither(
        Effect.gen(function* () {
          const repo = yield* BranchRepo;
          yield* repo.updateName({ id: "branch-1", name: "production" });
        }),
        env,
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toMatchObject({ _tag: "Conflict" });
      }
    });
  });
});
