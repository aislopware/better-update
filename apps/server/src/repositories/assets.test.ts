import { Effect, Exit } from "effect";

import { mockBatchD1, mockD1 } from "../../tests/helpers/mock-d1";
import { runWithLayerAndEnvExit } from "../../tests/helpers/runtime";
import { AssetRepo, AssetRepoLive } from "./assets";

const makeAssetRow = (overrides?: Partial<Record<string, unknown>>) => ({
  hash: "abc123",
  content_type: "application/javascript",
  file_ext: ".js",
  byte_size: 1024,
  r2_key: "assets/abc123.js",
  content_checksum: "abc123",
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const makeEnv = (db: unknown) => ({ DB: db }) as unknown as Env;

const runWithRepo = async <Ret, Err>(effect: Effect.Effect<Ret, Err, AssetRepo>, env: Env) =>
  runWithLayerAndEnvExit(effect, AssetRepoLive, env);

// -- Tests -----------------------------------------------------------------

describe("assetRepo -- D1 adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findByHashes", () => {
    it("returns assets for given hashes", async () => {
      const db = mockD1.forQuery({
        all: async () => ({
          results: [
            makeAssetRow({ hash: "abc123" }),
            makeAssetRow({ hash: "def456", content_type: "text/css", file_ext: ".css" }),
          ],
        }),
      });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* AssetRepo;
          return yield* repo.findByHashes({ hashes: ["abc123", "def456"] });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value).toHaveLength(2);
        expect(exit.value[0]).toStrictEqual(expect.objectContaining({ hash: "abc123" }));
        expect(exit.value[1]).toStrictEqual(expect.objectContaining({ contentType: "text/css" }));
      }
    });

    it("returns empty array for empty hashes without querying DB", async () => {
      const allFn = vi.fn<() => Promise<{ results: never[] }>>(async () => ({ results: [] }));
      const db = mockD1.forQuery({ all: allFn });
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* AssetRepo;
          return yield* repo.findByHashes({ hashes: [] });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value).toHaveLength(0);
      }
      expect(allFn).not.toHaveBeenCalled();
    });
  });

  describe("insertBatch", () => {
    it("succeeds for batch of assets", async () => {
      const db = mockBatchD1(async () => [{ results: [], success: true }]);
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* AssetRepo;
          yield* repo.insertBatch({
            assets: [
              {
                hash: "abc123",
                contentType: "application/javascript",
                fileExt: ".js",
                byteSize: 1024,
                r2Key: "assets/abc123.js",
                contentChecksum: "abc123",
              },
            ],
          });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    });

    it("succeeds with empty array without querying DB", async () => {
      const batchFn = vi.fn<() => Promise<never[]>>(async () => []);
      const db = mockBatchD1(batchFn);
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* AssetRepo;
          yield* repo.insertBatch({ assets: [] });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      expect(batchFn).not.toHaveBeenCalled();
    });
  });

  describe("updateByteSize", () => {
    it("succeeds on valid update", async () => {
      const db = mockD1.forRun(async () => ({ results: [], success: true }));
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* AssetRepo;
          yield* repo.updateByteSize({ hash: "abc123", byteSize: 2048 });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    });
  });
});
