import { Effect, Exit } from "effect";

import { runWithLayerAndEnvExit } from "../../tests/helpers/runtime";
import { AssetRepo, AssetRepoLive } from "./assets";

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

const mockBatchD1 = (batchFn: () => Promise<unknown>) => ({
  prepare: () => ({ bind: (..._args: unknown[]) => ({}) }),
  batch: batchFn,
});

const mockR2 = {
  put: vi.fn<() => Promise<null>>(async () => null),
  delete: vi.fn<() => Promise<null>>(async () => null),
};

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

const makeEnv = (db: unknown) => ({ DB: db, ASSETS_BUCKET: mockR2 }) as unknown as Env;

const runWithRepo = async <Ret, Err>(effect: Effect.Effect<Ret, Err, AssetRepo>, env: Env) =>
  runWithLayerAndEnvExit(effect, AssetRepoLive, env);

// -- Tests -----------------------------------------------------------------

describe("AssetRepo -- D1 adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findByHashes", () => {
    test("returns assets for given hashes", async () => {
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
        expect(exit.value[0]).toEqual(expect.objectContaining({ hash: "abc123" }));
        expect(exit.value[1]).toEqual(expect.objectContaining({ contentType: "text/css" }));
      }
    });

    test("returns empty array for empty hashes without querying DB", async () => {
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
    test("succeeds for batch of assets", async () => {
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

    test("succeeds with empty array without querying DB", async () => {
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

  describe("uploadBlob", () => {
    test("calls R2 put with correct arguments", async () => {
      const db = mockD1.forRun(async () => ({ results: [], success: true }));
      const env = makeEnv(db);

      const mockBody = new ReadableStream();

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* AssetRepo;
          yield* repo.uploadBlob({
            r2Key: "assets/abc123.js",
            body: mockBody,
            contentType: "application/javascript",
          });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      expect(mockR2.put).toHaveBeenCalledWith("assets/abc123.js", mockBody, {
        httpMetadata: { contentType: "application/javascript" },
      });
    });
  });

  describe("updateByteSize", () => {
    test("succeeds on valid update", async () => {
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

  describe("deleteBlobs", () => {
    test("calls R2 delete with correct keys", async () => {
      const db = mockD1.forRun(async () => ({ results: [], success: true }));
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* AssetRepo;
          yield* repo.deleteBlobs({ r2Keys: ["assets/abc123.js", "assets/def456.css"] });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      expect(mockR2.delete).toHaveBeenCalledWith(["assets/abc123.js", "assets/def456.css"]);
    });

    test("skips R2 call for empty array", async () => {
      const db = mockD1.forRun(async () => ({ results: [], success: true }));
      const env = makeEnv(db);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* AssetRepo;
          yield* repo.deleteBlobs({ r2Keys: [] });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      expect(mockR2.delete).not.toHaveBeenCalled();
    });
  });
});
