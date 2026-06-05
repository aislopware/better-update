import { Effect, Either, Exit } from "effect";

import { mockBatchD1, mockD1 } from "../../tests/helpers/mock-d1";
import { runEitherWithLayerAndEnv, runWithLayerAndEnvExit } from "../../tests/helpers/runtime";
import { EnvironmentRepo, EnvironmentRepoLive } from "./environments";

const makeEnv = (db: unknown) => ({ DB: db }) as unknown as Env;

const runWithRepo = async <Ret, Err>(effect: Effect.Effect<Ret, Err, EnvironmentRepo>, env: Env) =>
  runWithLayerAndEnvExit(effect, EnvironmentRepoLive, env);

const runWithRepoEither = async <Ret, Err>(
  effect: Effect.Effect<Ret, Err, EnvironmentRepo>,
  env: Env,
) => runEitherWithLayerAndEnv(effect, EnvironmentRepoLive, env);

describe("environmentRepo -- D1 adapter", () => {
  describe("insert", () => {
    it("succeeds on valid insert", async () => {
      const env = makeEnv(mockD1.forRun(async () => ({ success: true })));

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* EnvironmentRepo;
          yield* repo.insert({
            id: "env-1",
            organizationId: "org-1",
            name: "staging",
            createdAt: "2026-01-01T00:00:00Z",
          });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    });

    it("returns Conflict on UNIQUE constraint violation", async () => {
      const env = makeEnv(
        mockD1.forRun(() => {
          throw new Error("UNIQUE constraint failed: environments.name");
        }),
      );

      const result = await runWithRepoEither(
        Effect.gen(function* () {
          const repo = yield* EnvironmentRepo;
          yield* repo.insert({
            id: "env-1",
            organizationId: "org-1",
            name: "staging",
            createdAt: "2026-01-01T00:00:00Z",
          });
        }),
        env,
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toMatchObject({ _tag: "Conflict" });
      }
    });
  });

  describe("listByOrg", () => {
    it("maps rows to environment models", async () => {
      const env = makeEnv(
        mockD1.forQuery({
          all: async () => ({
            results: [
              {
                id: "env-1",
                organization_id: "org-1",
                name: "staging",
                created_at: "2026-01-01T00:00:00Z",
              },
            ],
          }),
        }),
      );

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* EnvironmentRepo;
          return yield* repo.listByOrg({ organizationId: "org-1" });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value).toStrictEqual([
          {
            id: "env-1",
            organizationId: "org-1",
            name: "staging",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ]);
      }
    });
  });

  describe("findByName", () => {
    it("returns NotFound when missing", async () => {
      const env = makeEnv(mockD1.forQuery({ first: async () => null }));

      const result = await runWithRepoEither(
        Effect.gen(function* () {
          const repo = yield* EnvironmentRepo;
          return yield* repo.findByName({ organizationId: "org-1", name: "ghost" });
        }),
        env,
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toMatchObject({ _tag: "NotFound" });
      }
    });
  });

  describe("countEnvVarsUsing", () => {
    it("returns the bound env-var count", async () => {
      const env = makeEnv(mockD1.forQuery({ first: async () => ({ count: 3 }) }));

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* EnvironmentRepo;
          return yield* repo.countEnvVarsUsing({ organizationId: "org-1", name: "staging" });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value).toBe(3);
      }
    });
  });

  describe("rename", () => {
    it("returns Conflict when the new name collides with an existing var key", async () => {
      const env = makeEnv(
        mockBatchD1(() => {
          throw new Error("UNIQUE constraint failed: env_vars.environment");
        }),
      );

      const result = await runWithRepoEither(
        Effect.gen(function* () {
          const repo = yield* EnvironmentRepo;
          yield* repo.rename({ organizationId: "org-1", oldName: "staging", newName: "qa" });
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
