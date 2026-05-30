import { Effect, Exit } from "effect";

import { runWithLayerAndEnvExit } from "../../tests/helpers/runtime";
import { BundleRepo, BundleRepoLive } from "./bundle";

const makeR2Object = (overrides?: Partial<Record<string, unknown>>) =>
  ({
    body: new ReadableStream(),
    size: 42,
    httpEtag: '"etag-123"',
    httpMetadata: { contentType: "application/octet-stream" },
    uploaded: new Date("2026-01-01T00:00:00Z"),
    checksums: {},
    ...overrides,
  }) as unknown as R2ObjectBody;

const makeEnv = (getFn: (key: string) => Promise<R2ObjectBody | null>) =>
  ({ ASSETS_BUCKET: { get: getFn } }) as unknown as Env;

const runWithRepo = async <Ret, Err>(effect: Effect.Effect<Ret, Err, BundleRepo>, env: Env) =>
  runWithLayerAndEnvExit(effect, BundleRepoLive, env);

describe("bundleRepo -- R2 adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getPatch", () => {
    it("returns a StoredBlob for the exact patch key when present", async () => {
      const getFn = vi.fn<(key: string) => Promise<R2ObjectBody | null>>(async () =>
        makeR2Object(),
      );
      const env = makeEnv(getFn);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* BundleRepo;
          return yield* repo.getPatch({ key: "patches/proj/1.0.0/ios/from__to.bsdiff" });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value).not.toBeNull();
        expect(exit.value?.size).toBe(42);
        expect(exit.value?.contentType).toBe("application/octet-stream");
      }
      expect(getFn).toHaveBeenCalledWith("patches/proj/1.0.0/ios/from__to.bsdiff");
    });

    it("returns null on miss", async () => {
      const env = makeEnv(async () => null);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* BundleRepo;
          return yield* repo.getPatch({ key: "patches/proj/1.0.0/ios/missing.bsdiff" });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value).toBeNull();
      }
    });
  });

  describe("getFullBundle", () => {
    it("reads the full bundle from the assets/{hash} key", async () => {
      const getFn = vi.fn<(key: string) => Promise<R2ObjectBody | null>>(async () =>
        makeR2Object(),
      );
      const env = makeEnv(getFn);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* BundleRepo;
          return yield* repo.getFullBundle({ hash: "abc123" });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value).not.toBeNull();
      }
      expect(getFn).toHaveBeenCalledWith("assets/abc123");
    });

    it("returns null when the full bundle object is absent", async () => {
      const env = makeEnv(async () => null);

      const exit = await runWithRepo(
        Effect.gen(function* () {
          const repo = yield* BundleRepo;
          return yield* repo.getFullBundle({ hash: "missing" });
        }),
        env,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value).toBeNull();
      }
    });
  });
});
