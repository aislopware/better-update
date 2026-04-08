import { Branch, Conflict, NotFound } from "@better-update/api";
import { Effect, Either, Exit } from "effect";

import { setRequestContext } from "../cloudflare/context";
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

const runWithRepo = async <Ret, Err>(effect: Effect.Effect<Ret, Err, BranchRepo>) =>
  effect.pipe(Effect.provide(BranchRepoLive), Effect.runPromiseExit);

// -- Tests -----------------------------------------------------------------

describe("BranchRepo -- D1 adapter", () => {
  describe("insert", () => {
    test("succeeds on valid insert", async () => {
      const db = mockD1.forRun(async () => ({ results: [], success: true }));
      setRequestContext({ DB: db } as unknown as Env, {} as ExecutionContext);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* BranchRepo;
          yield* repo.insert(makeInsertParams());
        }),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    });

    test("returns Conflict on UNIQUE constraint violation", async () => {
      const db = mockD1.forRun(() => {
        throw new Error("UNIQUE constraint failed: branches.name");
      });
      setRequestContext({ DB: db } as unknown as Env, {} as ExecutionContext);

      const result = await Effect.gen(function* () {
        const repo = yield* BranchRepo;
        yield* repo.insert(makeInsertParams());
      }).pipe(Effect.provide(BranchRepoLive), Effect.either, Effect.runPromise);

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(Conflict);
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
      setRequestContext({ DB: db } as unknown as Env, {} as ExecutionContext);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* BranchRepo;
          return yield* repo.findByProject({ projectId: "proj-1", limit: 20, offset: 0 });
        }),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const result = exit.value;
        expect(result.total).toBe(2);
        expect(result.items).toHaveLength(2);
        expect(result.items[0]).toBeInstanceOf(Branch);
        expect(result.items[0]!.name).toBe("production");
      }
    });

    test("returns empty items when no branches exist", async () => {
      const db = mockD1.forQuery({
        first: async () => ({ count: 0 }),
        all: async () => ({ results: [] }),
      });
      setRequestContext({ DB: db } as unknown as Env, {} as ExecutionContext);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* BranchRepo;
          return yield* repo.findByProject({ projectId: "proj-1", limit: 20, offset: 0 });
        }),
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
      setRequestContext({ DB: db } as unknown as Env, {} as ExecutionContext);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* BranchRepo;
          return yield* repo.findById({ id: "b1" });
        }),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value).toBeInstanceOf(Branch);
        expect(exit.value.name).toBe("production");
      }
    });

    test("returns NotFound when not found", async () => {
      const db = mockD1.forQuery({
        first: async () => null,
      });
      setRequestContext({ DB: db } as unknown as Env, {} as ExecutionContext);

      const result = await Effect.gen(function* () {
        const repo = yield* BranchRepo;
        return yield* repo.findById({ id: "nonexistent" });
      }).pipe(Effect.provide(BranchRepoLive), Effect.either, Effect.runPromise);

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(NotFound);
      }
    });
  });

  describe("updateName", () => {
    test("succeeds on valid update", async () => {
      const db = mockD1.forRun(async () => ({ results: [], success: true }));
      setRequestContext({ DB: db } as unknown as Env, {} as ExecutionContext);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* BranchRepo;
          yield* repo.updateName({ id: "branch-1", name: "staging" });
        }),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    });

    test("returns Conflict on UNIQUE constraint violation", async () => {
      const db = mockD1.forRun(() => {
        throw new Error("UNIQUE constraint failed: branches.name");
      });
      setRequestContext({ DB: db } as unknown as Env, {} as ExecutionContext);

      const result = await Effect.gen(function* () {
        const repo = yield* BranchRepo;
        yield* repo.updateName({ id: "branch-1", name: "production" });
      }).pipe(Effect.provide(BranchRepoLive), Effect.either, Effect.runPromise);

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(Conflict);
      }
    });
  });
});
