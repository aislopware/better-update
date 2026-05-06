import { Effect, Either, Exit } from "effect";

import { mockBatchD1, mockD1 } from "../../tests/helpers/mock-d1";
import { runEitherWithLayerAndEnv, runWithLayerAndEnvExit } from "../../tests/helpers/runtime";
import { UpdateRepo, UpdateRepoLive } from "./updates";

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

describe("updateRepo -- D1 adapter", () => {
  describe("insert", () => {
    it("succeeds and returns Update", async () => {
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
        expect(exit.value).toStrictEqual(
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
    it("returns items and total", async () => {
      const db = mockD1.forQuery({
        first: async () => ({ count: 3 }),
        all: async () => ({
          results: [
            makeUpdateRow({ id: "upd-1", message: "first", created_at: "2026-01-03T00:00:00Z" }),
            makeUpdateRow({
              id: "upd-2",
              message: "second",
              is_rollback: 1,
              created_at: "2026-01-02T00:00:00Z",
            }),
          ],
        }),
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* UpdateRepo;
          return yield* repo.findByProject({
            projectId: "proj-1",
            sort: "createdAt",
            order: "desc",
            limit: 2,
            offset: 0,
          });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const result = exit.value;
        expect(result.total).toBe(3);
        expect(result.items).toHaveLength(2);
        expect(result.items[0]).toStrictEqual(
          expect.objectContaining({ message: "first", isRollback: false }),
        );
        expect(result.items[1]).toStrictEqual(expect.objectContaining({ isRollback: true }));
      }
    });

    it("returns empty items when no updates exist", async () => {
      const db = mockD1.forQuery({
        first: async () => ({ count: 0 }),
        all: async () => ({ results: [] }),
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* UpdateRepo;
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
        expect(exit.value.items).toHaveLength(0);
        expect(exit.value.total).toBe(0);
      }
    });

    it("filters by branchId and platform", async () => {
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
            platform: "ios",
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
        expect(result.items).toHaveLength(1);
        expect(result.items[0]!.branchId).toBe("branch-2");
        expect(result.total).toBe(1);
      }
    });
  });

  describe("findById", () => {
    it("returns update when found", async () => {
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
        expect(exit.value).toStrictEqual(
          expect.objectContaining({ message: "initial release", isRollback: true }),
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
    it("returns array of updates", async () => {
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
        expect(exit.value[0]).toStrictEqual(expect.objectContaining({ id: "upd-1" }));
        expect(exit.value[1]).toStrictEqual(expect.objectContaining({ platform: "android" }));
      }
    });
  });

  describe("deleteGroup", () => {
    it("returns deleted count", async () => {
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
    it("succeeds on valid update", async () => {
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
