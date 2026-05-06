import { Effect, Either, Exit } from "effect";

import { mockD1 } from "../../tests/helpers/mock-d1";
import { runEitherWithLayerAndEnv, runWithLayerAndEnvExit } from "../../tests/helpers/runtime";
import { ChannelRepo, ChannelRepoLive } from "./channels";

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

describe("channelRepo -- D1 adapter", () => {
  describe("insert", () => {
    it("succeeds and returns Channel", async () => {
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
        expect(exit.value).toStrictEqual(
          expect.objectContaining({
            name: "production",
            branchId: "branch-1",
            isPaused: false,
            cacheVersion: 0,
          }),
        );
      }
    });

    it("returns Conflict on UNIQUE constraint violation", async () => {
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
    it("returns items and total count", async () => {
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
          return yield* repo.findByProject({
            projectId: "proj-1",
            sort: "createdAt",
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
        expect(result.items[0]).toStrictEqual(
          expect.objectContaining({ name: "production", isPaused: false }),
        );
        expect(result.items[1]).toStrictEqual(expect.objectContaining({ isPaused: true }));
      }
    });

    it("returns empty items when no channels exist", async () => {
      const db = mockD1.forQuery({
        first: async () => ({ count: 0 }),
        all: async () => ({ results: [] }),
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          return yield* repo.findByProject({
            projectId: "proj-1",
            sort: "createdAt",
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
    it("returns channel when found", async () => {
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
        expect(exit.value).toStrictEqual(
          expect.objectContaining({ name: "production", isPaused: true }),
        );
      }
    });

    it("returns NotFound when not found", async () => {
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
    it("succeeds on valid update", async () => {
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
    it("succeeds with isPaused true", async () => {
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

    it("succeeds with isPaused false", async () => {
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
    it("succeeds on valid update", async () => {
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
    it("succeeds on valid update", async () => {
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
    it("succeeds on valid update", async () => {
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
