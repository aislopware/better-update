import { Effect, Either, Exit } from "effect";

import { runEitherWithLayerAndEnv, runWithLayerAndEnvExit } from "../../tests/helpers/runtime";
import { ChannelRepo, ChannelRepoLive } from "./channels";

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

const makeChannelRow = (overrides?: Partial<Record<string, unknown>>) => ({
  id: "ch-1",
  project_id: "proj-1",
  name: "production",
  branch_id: "branch-1",
  branch_mapping_json: null,
  cache_version: 0,
  is_paused: 0,
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const makeEnv = (db: unknown) => ({ DB: db }) as unknown as Env;

const runWithRepo = async <Ret, Err>(effect: Effect.Effect<Ret, Err, ChannelRepo>, env: Env) =>
  runWithLayerAndEnvExit(effect, ChannelRepoLive, env);

const runWithRepoEither = async <Ret, Err>(
  effect: Effect.Effect<Ret, Err, ChannelRepo>,
  env: Env,
) => runEitherWithLayerAndEnv(effect, ChannelRepoLive, env);

// -- Tests -----------------------------------------------------------------

describe("ChannelRepo -- D1 adapter", () => {
  describe("insert", () => {
    test("succeeds and returns Channel", async () => {
      const db = mockD1.forRun(async () => ({ results: [], success: true }));
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          return yield* repo.insert({
            projectId: "proj-1",
            name: "production",
            branchId: "branch-1",
          });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value).toEqual(
          expect.objectContaining({
            name: "production",
            branchId: "branch-1",
            isPaused: false,
            cacheVersion: 0,
          }),
        );
      }
    });

    test("returns Conflict on UNIQUE constraint violation", async () => {
      const db = mockD1.forRun(() => {
        throw new Error("UNIQUE constraint failed: channels.name");
      });
      const env = makeEnv(db);

      const result = await runWithRepoEither(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          yield* repo.insert({ projectId: "proj-1", name: "production", branchId: "branch-1" });
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
            makeChannelRow({ id: "ch-1", name: "production" }),
            makeChannelRow({ id: "ch-2", name: "staging", is_paused: 1 }),
          ],
        }),
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          return yield* repo.findByProject({ projectId: "proj-1", limit: 20, offset: 0 });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const result = exit.value;
        expect(result.total).toBe(2);
        expect(result.items).toHaveLength(2);
        expect(result.items[0]).toEqual(
          expect.objectContaining({ name: "production", isPaused: false }),
        );
        expect(result.items[1]).toEqual(expect.objectContaining({ isPaused: true }));
      }
    });

    test("returns empty items when no channels exist", async () => {
      const db = mockD1.forQuery({
        first: async () => ({ count: 0 }),
        all: async () => ({ results: [] }),
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
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
    test("returns channel when found", async () => {
      const row = makeChannelRow({ is_paused: 1 });
      const db = mockD1.forQuery({
        first: async () => row,
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          return yield* repo.findById({ id: "ch-1" });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value).toEqual(expect.objectContaining({ name: "production", isPaused: true }));
      }
    });

    test("returns NotFound when not found", async () => {
      const db = mockD1.forQuery({
        first: async () => null,
      });
      const env = makeEnv(db);

      const result = await runWithRepoEither(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
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

  describe("updateBranchId", () => {
    test("succeeds on valid update", async () => {
      const db = mockD1.forRun(async () => ({ results: [], success: true }));
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          yield* repo.updateBranchId({ id: "ch-1", branchId: "branch-2" });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    });
  });

  describe("setPaused", () => {
    test("succeeds with isPaused true", async () => {
      const db = mockD1.forRun(async () => ({ results: [], success: true }));
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          yield* repo.setPaused({ id: "ch-1", isPaused: true });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    });

    test("succeeds with isPaused false", async () => {
      const db = mockD1.forRun(async () => ({ results: [], success: true }));
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          yield* repo.setPaused({ id: "ch-1", isPaused: false });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    });
  });

  describe("setBranchMapping", () => {
    test("succeeds on valid update", async () => {
      const db = mockD1.forRun(async () => ({ results: [], success: true }));
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          yield* repo.setBranchMapping({
            id: "ch-1",
            branchMappingJson: '{"data":[],"salt":"s"}',
          });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    });
  });

  describe("completeBranchRollout", () => {
    test("succeeds on valid update", async () => {
      const db = mockD1.forRun(async () => ({ results: [], success: true }));
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          yield* repo.completeBranchRollout({ id: "ch-1", branchId: "branch-2" });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    });
  });

  describe("revertBranchRollout", () => {
    test("succeeds on valid update", async () => {
      const db = mockD1.forRun(async () => ({ results: [], success: true }));
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          yield* repo.revertBranchRollout({ id: "ch-1" });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    });
  });
});
