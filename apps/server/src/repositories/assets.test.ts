import { Asset } from "@better-update/api";
import { Effect, Exit } from "effect";

import { setRequestContext } from "../cloudflare/context";
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
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const runWithRepo = async <Ret, Err>(effect: Effect.Effect<Ret, Err, AssetRepo>) =>
  effect.pipe(Effect.provide(AssetRepoLive), Effect.runPromiseExit);

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
      setRequestContext(
        { DB: db, ASSETS_BUCKET: mockR2 } as unknown as Env,
        {} as ExecutionContext,
      );

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* AssetRepo;
          return yield* repo.findByHashes({ hashes: ["abc123", "def456"] });
        }),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value).toHaveLength(2);
        expect(exit.value[0]).toBeInstanceOf(Asset);
        expect(exit.value[0]!.hash).toBe("abc123");
        expect(exit.value[1]!.contentType).toBe("text/css");
      }
    });

    test("returns empty array for empty hashes without querying DB", async () => {
      const allFn = vi.fn<() => Promise<{ results: never[] }>>(async () => ({ results: [] }));
      const db = mockD1.forQuery({ all: allFn });
      setRequestContext(
        { DB: db, ASSETS_BUCKET: mockR2 } as unknown as Env,
        {} as ExecutionContext,
      );

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* AssetRepo;
          return yield* repo.findByHashes({ hashes: [] });
        }),
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
      setRequestContext(
        { DB: db, ASSETS_BUCKET: mockR2 } as unknown as Env,
        {} as ExecutionContext,
      );

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
              },
            ],
          });
        }),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    });

    test("succeeds with empty array without querying DB", async () => {
      const batchFn = vi.fn<() => Promise<never[]>>(async () => []);
      const db = mockBatchD1(batchFn);
      setRequestContext(
        { DB: db, ASSETS_BUCKET: mockR2 } as unknown as Env,
        {} as ExecutionContext,
      );

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* AssetRepo;
          yield* repo.insertBatch({ assets: [] });
        }),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      expect(batchFn).not.toHaveBeenCalled();
    });
  });

  describe("uploadBlob", () => {
    test("calls R2 put with correct arguments", async () => {
      const db = mockD1.forRun(async () => ({ results: [], success: true }));
      setRequestContext(
        { DB: db, ASSETS_BUCKET: mockR2 } as unknown as Env,
        {} as ExecutionContext,
      );

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
      setRequestContext(
        { DB: db, ASSETS_BUCKET: mockR2 } as unknown as Env,
        {} as ExecutionContext,
      );

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* AssetRepo;
          yield* repo.updateByteSize({ hash: "abc123", byteSize: 2048 });
        }),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    });
  });

  describe("deleteBlobs", () => {
    test("calls R2 delete with correct keys", async () => {
      const db = mockD1.forRun(async () => ({ results: [], success: true }));
      setRequestContext(
        { DB: db, ASSETS_BUCKET: mockR2 } as unknown as Env,
        {} as ExecutionContext,
      );

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* AssetRepo;
          yield* repo.deleteBlobs({ r2Keys: ["assets/abc123.js", "assets/def456.css"] });
        }),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      expect(mockR2.delete).toHaveBeenCalledWith(["assets/abc123.js", "assets/def456.css"]);
    });

    test("skips R2 call for empty array", async () => {
      const db = mockD1.forRun(async () => ({ results: [], success: true }));
      setRequestContext(
        { DB: db, ASSETS_BUCKET: mockR2 } as unknown as Env,
        {} as ExecutionContext,
      );

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* AssetRepo;
          yield* repo.deleteBlobs({ r2Keys: [] });
        }),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      expect(mockR2.delete).not.toHaveBeenCalled();
    });
  });
});
