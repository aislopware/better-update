import { handleScheduled } from "./patch-gc";

// -- Mock helpers -------------------------------------------------------------

interface MockExpiredPatch {
  old_asset_hash: string;
  new_asset_hash: string;
  r2_key: string;
}

const createMockEnv = (expiredPatches: MockExpiredPatch[]) => {
  const deletedR2Keys: string[][] = [];
  const deletedD1Batches: number[] = [];

  // Track how many rows have been "consumed" across batches
  let consumed = 0;

  const env = {
    DB: {
      prepare: (query: string) => ({
        bind: (..._bindings: unknown[]) => ({
          all: async () => {
            if (query.includes("SELECT")) {
              // Return next batch of 100 (or remaining)
              const batch = expiredPatches.slice(consumed, consumed + 100);
              consumed += batch.length;
              return { results: batch };
            }
            return { results: [] };
          },
        }),
      }),
      batch: async (statements: unknown[]) => {
        deletedD1Batches.push(statements.length);
      },
    },
    ASSETS_BUCKET: {
      delete: async (keys: string[]) => {
        deletedR2Keys.push(keys);
      },
    },
    PATCH_RETENTION_DAYS: "30",
    BUILD_BUCKET: {
      list: async () => ({ objects: [] }),
      delete: async () => {},
    },
    BUILD_RETENTION_PRODUCTION: "90",
    BUILD_RETENTION_PREVIEW: "30",
    BUILD_RETENTION_DEVELOPMENT: "7",
  } as unknown as Env;

  return { env, deletedR2Keys, deletedD1Batches };
};

const makePatch = (idx: number): MockExpiredPatch => ({
  old_asset_hash: `old-${idx}`,
  new_asset_hash: `new-${idx}`,
  r2_key: `patches/old-${idx}/new-${idx}.patch`,
});

// -- Tests --------------------------------------------------------------------

describe("handleScheduled (patch GC)", () => {
  test("does nothing when no expired patches exist", async () => {
    const { env, deletedR2Keys, deletedD1Batches } = createMockEnv([]);

    await handleScheduled(env);

    expect(deletedR2Keys).toHaveLength(0);
    expect(deletedD1Batches).toHaveLength(0);
  });

  test("deletes a single batch of expired patches", async () => {
    const patches = Array.from({ length: 50 }, (_, idx) => makePatch(idx));
    const { env, deletedR2Keys, deletedD1Batches } = createMockEnv(patches);

    await handleScheduled(env);

    // One batch of 50 R2 deletions
    expect(deletedR2Keys).toHaveLength(1);
    expect(deletedR2Keys[0]).toHaveLength(50);

    // One D1 batch of 50 DELETE statements
    expect(deletedD1Batches).toHaveLength(1);
    expect(deletedD1Batches[0]).toBe(50);
  });

  test("processes multiple batches for 150 expired patches", async () => {
    const patches = Array.from({ length: 150 }, (_, idx) => makePatch(idx));
    const { env, deletedR2Keys, deletedD1Batches } = createMockEnv(patches);

    await handleScheduled(env);

    // 2 batches: 100 + 50
    expect(deletedR2Keys).toHaveLength(2);
    expect(deletedR2Keys[0]).toHaveLength(100);
    expect(deletedR2Keys[1]).toHaveLength(50);

    expect(deletedD1Batches).toHaveLength(2);
    expect(deletedD1Batches[0]).toBe(100);
    expect(deletedD1Batches[1]).toBe(50);
  });

  test("uses PATCH_RETENTION_DAYS from env", async () => {
    let capturedCutoff = "";
    let captured = false;

    const env = {
      DB: {
        prepare: (query: string) => ({
          bind: (...args: unknown[]) => ({
            all: async () => {
              // Only capture the patch GC query cutoff (first SELECT with patches)
              if (query.includes("patches") && !captured) {
                capturedCutoff = args[0] as string;
                captured = true;
              }
              return { results: [] };
            },
          }),
        }),
        batch: async () => {},
      },
      ASSETS_BUCKET: {
        delete: async () => {},
      },
      PATCH_RETENTION_DAYS: "7",
      BUILD_BUCKET: {
        list: async () => ({ objects: [] }),
        delete: async () => {},
      },
      BUILD_RETENTION_PRODUCTION: "90",
      BUILD_RETENTION_PREVIEW: "30",
      BUILD_RETENTION_DEVELOPMENT: "7",
    } as unknown as Env;

    const before = new Date(Date.now() - 7 * 86_400_000).toISOString();
    await handleScheduled(env);
    const after = new Date(Date.now() - 7 * 86_400_000).toISOString();

    // The cutoff should be approximately 7 days ago
    expect(capturedCutoff >= before).toBe(true);
    expect(capturedCutoff <= after).toBe(true);
  });
});
