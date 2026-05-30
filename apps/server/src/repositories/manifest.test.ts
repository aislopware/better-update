import { Effect, Exit } from "effect";

import { mockD1 } from "../../tests/helpers/mock-d1";
import { runWithLayerAndEnvExit } from "../../tests/helpers/runtime";
import { ManifestRepo, ManifestRepoLive } from "./manifest";

const makeEnv = (db: unknown) => ({ DB: db }) as unknown as Env;

const runWithRepo = async <Ret, Err>(effect: Effect.Effect<Ret, Err, ManifestRepo>, env: Env) =>
  runWithLayerAndEnvExit(effect, ManifestRepoLive, env);

describe("manifestRepo -- findLaunchAssetForUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the launch asset row for the update", async () => {
    const db = mockD1.forQuery({
      first: async () => ({
        hash: "abc123",
        r2_key: "assets/abc123",
        content_type: "application/octet-stream",
        runtime_version: "1.0.0",
      }),
    });

    const exit = await runWithRepo(
      Effect.gen(function* () {
        const repo = yield* ManifestRepo;
        return yield* repo.findLaunchAssetForUpdate({ updateId: "update-1" });
      }),
      makeEnv(db),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toStrictEqual({
        hash: "abc123",
        r2_key: "assets/abc123",
        content_type: "application/octet-stream",
        runtime_version: "1.0.0",
      });
    }
  });

  it("returns null when no launch asset exists for the update", async () => {
    const db = mockD1.forQuery({ first: async () => null });

    const exit = await runWithRepo(
      Effect.gen(function* () {
        const repo = yield* ManifestRepo;
        return yield* repo.findLaunchAssetForUpdate({ updateId: "missing" });
      }),
      makeEnv(db),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toBeNull();
    }
  });
});
