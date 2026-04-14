import { Effect, Either, Exit } from "effect";

import { runEitherWithLayerAndEnv, runWithLayerAndEnvExit } from "../../tests/helpers/runtime";
import { UpdateRepo, UpdateRepoLive } from "./updates";

// -- Mock D1 helpers -------------------------------------------------------

const mockD1 = {
  forQuery: (opts: { first?: () => Promise<unknown>; all?: () => Promise<unknown> }) => ({
    prepare: () => ({
      bind: (..._args: unknown[]) => ({
        first: opts.first ?? (async () => null),
        all: opts.all ?? (async () => ({ results: [] })),
      }),
    }),
  }),
};

const mockBatchD1 = (batchFn: () => Promise<unknown>) => ({
  prepare: () => ({ bind: (..._args: unknown[]) => ({}) }),
  batch: batchFn,
});

const makeUpdateRow = (overrides?: Partial<Record<string, unknown>>) => ({
  id: "upd-1",
  branch_id: "branch-1",
  runtime_version: "1.0.0",
  platform: "ios",
  message: "initial release",
  metadata_json: "{}",
  extra_json: null,
  group_id: "group-1",
  rollout_percentage: 100,
  is_rollback: 0,
  signature: null,
  certificate_chain: null,
  manifest_body: null,
  directive_body: null,
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const makeEnv = (db: unknown) => ({ DB: db }) as unknown as Env;

const runWithRepo = async <Ret, Err>(effect: Effect.Effect<Ret, Err, UpdateRepo>, env: Env) =>
  runWithLayerAndEnvExit(effect, UpdateRepoLive, env);

const runWithRepoEither = async <Ret, Err>(effect: Effect.Effect<Ret, Err, UpdateRepo>, env: Env) =>
  runEitherWithLayerAndEnv(effect, UpdateRepoLive, env);

// -- Tests -----------------------------------------------------------------

describe("UpdateRepo -- D1 adapter", () => {
  describe("insert", () => {
    test("succeeds and returns Update", async () => {
      const db = mockBatchD1(async () => [{ results: [], success: true }]);
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* UpdateRepo;
          return yield* repo.insert({
            branchId: "branch-1",
            runtimeVersion: "1.0.0",
            platform: "ios",
            message: "initial release",
            metadataJson: "{}",
            extraJson: null,
            groupId: "group-1",
            rolloutPercentage: 100,
            isRollback: false,
            signature: null,
            certificateChain: null,
            manifestBody: null,
            directiveBody: null,
            assets: [{ key: "bundle.js", hash: "abc123", isLaunch: true }],
          });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value).toEqual(
          expect.objectContaining({
            branchId: "branch-1",
            runtimeVersion: "1.0.0",
            platform: "ios",
            message: "initial release",
            rolloutPercentage: 100,
            isRollback: false,
            groupId: "group-1",
          }),
        );
      }
    });
  });

  describe("findByProject", () => {
    test("returns items and total count", async () => {
      const db = mockD1.forQuery({
        first: async () => ({ count: 2 }),
        all: async () => ({
          results: [
            makeUpdateRow({ id: "upd-1", message: "first" }),
            makeUpdateRow({ id: "upd-2", message: "second", is_rollback: 1 }),
          ],
        }),
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* UpdateRepo;
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
          expect.objectContaining({ message: "first", isRollback: false }),
        );
        expect(result.items[1]).toEqual(expect.objectContaining({ isRollback: true }));
      }
    });

    test("returns empty items when no updates exist", async () => {
      const db = mockD1.forQuery({
        first: async () => ({ count: 0 }),
        all: async () => ({ results: [] }),
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* UpdateRepo;
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

    test("filters by branchId when provided", async () => {
      const db = mockD1.forQuery({
        first: async () => ({ count: 1 }),
        all: async () => ({
          results: [makeUpdateRow({ id: "upd-1", branch_id: "branch-2" })],
        }),
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* UpdateRepo;
          return yield* repo.findByProject({
            projectId: "proj-1",
            branchId: "branch-2",
            limit: 20,
            offset: 0,
          });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const result = exit.value;
        expect(result.total).toBe(1);
        expect(result.items).toHaveLength(1);
        expect(result.items[0]!.branchId).toBe("branch-2");
      }
    });
  });

  describe("findById", () => {
    test("returns update when found", async () => {
      const row = makeUpdateRow({ is_rollback: 1 });
      const db = mockD1.forQuery({
        first: async () => row,
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* UpdateRepo;
          return yield* repo.findById({ id: "upd-1" });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value).toEqual(
          expect.objectContaining({ message: "initial release", isRollback: true }),
        );
      }
    });

    test("returns NotFound when not found", async () => {
      const db = mockD1.forQuery({
        first: async () => null,
      });
      const env = makeEnv(db);

      const result = await runWithRepoEither(
        Effect.gen(function* () {
          const repo = yield* UpdateRepo;
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

  describe("findByGroupId", () => {
    test("returns array of updates", async () => {
      const db = mockD1.forQuery({
        all: async () => ({
          results: [
            makeUpdateRow({ id: "upd-1" }),
            makeUpdateRow({ id: "upd-2", platform: "android" }),
          ],
        }),
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* UpdateRepo;
          return yield* repo.findByGroupId({ groupId: "group-1" });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value).toHaveLength(2);
        expect(exit.value[0]).toEqual(expect.objectContaining({ id: "upd-1" }));
        expect(exit.value[1]).toEqual(expect.objectContaining({ platform: "android" }));
      }
    });
  });

  describe("deleteGroup", () => {
    test("returns deleted count", async () => {
      const db = mockBatchD1(async () => [
        { results: [], success: true },
        { results: [], success: true, meta: { changes: 2 } },
      ]);
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* UpdateRepo;
          return yield* repo.deleteGroup({ groupId: "group-1" });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.deleted).toBe(2);
      }
    });
  });

  describe("updateRollout", () => {
    test("succeeds on valid update", async () => {
      const db = {
        prepare: () => ({
          bind: (..._args: unknown[]) => ({
            run: async () => ({ results: [], success: true }),
          }),
        }),
      };
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* UpdateRepo;
          yield* repo.updateRollout({ id: "upd-1", percentage: 50 });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    });
  });
});
