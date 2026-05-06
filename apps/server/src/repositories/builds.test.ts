import { Effect, Exit } from "effect";

import { mockD1 } from "../../tests/helpers/mock-d1";
import { runWithLayerAndEnvExit } from "../../tests/helpers/runtime";
import { BuildRepo, BuildRepoLive } from "./builds";

import type { BuildWithArtifactRow } from "./build-row";

const makeEnv = (db: unknown) => ({ DB: db }) as unknown as Env;

const runWithRepo = async <Ret, Err>(effect: Effect.Effect<Ret, Err, BuildRepo>, env: Env) =>
  runWithLayerAndEnvExit(effect, BuildRepoLive, env);

const makeRow = (id: string, createdAt: string): BuildWithArtifactRow => ({
  id,
  project_id: "proj-1",
  platform: "ios",
  profile: "production",
  distribution: "ad-hoc",
  runtime_version: "1.0.0",
  app_version: "1.0.0",
  build_number: "1",
  bundle_id: "com.example.app",
  git_ref: null,
  git_commit: null,
  message: "Test build",
  metadata_json: "{}",
  created_at: createdAt,
  a_r2_key: "builds/abc.ipa",
  a_format: "ipa",
  a_content_type: "application/octet-stream",
  a_byte_size: 1024,
  a_sha256: "deadbeef",
});

describe("buildRepo — list page pagination", () => {
  it("returns items + total when results exist", async () => {
    const rows = [
      makeRow("z", "2026-01-03T00:00:00.000Z"),
      makeRow("y", "2026-01-02T00:00:00.000Z"),
    ];
    const db = mockD1.forQuery({
      first: async () => ({ count: 3 }),
      all: async () => ({ results: rows }),
    });

    const exit = await runWithRepo(
      Effect.gen(function* () {
        const repo = yield* BuildRepo;
        return yield* repo.list({
          projectId: "proj-1",
          sort: "createdAt",
          order: "desc",
          limit: 2,
          offset: 0,
        });
      }),
      makeEnv(db),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.items).toHaveLength(2);
      expect(exit.value.items[0]?.id).toBe("z");
      expect(exit.value.total).toBe(3);
    }
  });

  it("returns empty items when result is empty", async () => {
    const db = mockD1.forQuery({
      first: async () => ({ count: 0 }),
      all: async () => ({ results: [] }),
    });

    const exit = await runWithRepo(
      Effect.gen(function* () {
        const repo = yield* BuildRepo;
        return yield* repo.list({
          projectId: "proj-1",
          sort: "createdAt",
          order: "desc",
          limit: 10,
          offset: 0,
        });
      }),
      makeEnv(db),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.items).toHaveLength(0);
      expect(exit.value.total).toBe(0);
    }
  });

  it("accepts filter values", async () => {
    const db = mockD1.forQuery({
      first: async () => ({ count: 0 }),
      all: async () => ({ results: [] }),
    });

    const exit = await runWithRepo(
      Effect.gen(function* () {
        const repo = yield* BuildRepo;
        return yield* repo.list({
          projectId: "proj-1",
          platform: "android",
          profile: "preview",
          runtimeVersion: "2.0.0",
          distribution: "play-store",
          sort: "createdAt",
          order: "desc",
          limit: 25,
          offset: 0,
        });
      }),
      makeEnv(db),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });
});
