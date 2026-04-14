import { handlePatchMessage } from "./patch-queue";

// Controls the patch size returned by the bsdiff mock.
// Default: 20% of old bundle size. Tests can override per-case.
let mockPatchRatio = 0.2;

vi.mock(import("@better-update/bsdiff-wasm"), () => ({
  diff: (oldData: Uint8Array, _newData: Uint8Array) => {
    const patchSize = Math.floor(oldData.length * mockPatchRatio);
    return new Uint8Array(patchSize > 0 ? patchSize : 1);
  },
}));

// -- Env mock factory ---------------------------------------------------------

const createR2Object = (data: Uint8Array) => ({
  size: data.length,
  arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  writeHttpMetadata: () => {},
  httpEtag: '"mock"',
  body: new Response(Uint8Array.from(data)).body,
  httpMetadata: { contentType: "application/javascript" },
  uploaded: new Date("2026-01-01T00:00:00Z"),
});

const createMockEnv = (overrides?: {
  existingPatch?: boolean;
  oldBundle?: Uint8Array | null;
  newBundle?: Uint8Array | null;
  maxBundleSize?: string;
  minSaving?: string;
}) => {
  const existingPatch = overrides?.existingPatch ?? false;
  const oldBundle = overrides?.oldBundle === undefined ? new Uint8Array(1000) : overrides.oldBundle;
  const newBundle = overrides?.newBundle === undefined ? new Uint8Array(1200) : overrides.newBundle;

  const putCalls: { key: string; body: unknown }[] = [];
  const runCalls: { query: string; bindings: unknown[] }[] = [];
  const assetRows = new Map<string, { readonly r2_key: string }>([
    ["oldhash123", { r2_key: "assets/oldhash123.bundle" }],
    ["newhash456", { r2_key: "assets/newhash456.bundle" }],
  ]);

  const env = {
    DB: {
      prepare: (query: string) => ({
        bind: (...bindings: unknown[]) => ({
          first: async () => {
            if (query.includes('FROM "patches"')) {
              return existingPatch ? { exists: 1 } : null;
            }

            if (query.includes('FROM "assets"')) {
              const [hash] = bindings;
              return typeof hash === "string" ? (assetRows.get(hash) ?? null) : null;
            }

            return null;
          },
          run: async () => {
            runCalls.push({ query, bindings });
          },
        }),
      }),
    },
    ASSETS_BUCKET: {
      get: async (key: string) => {
        if (key === "assets/oldhash123.bundle" && oldBundle) {
          return createR2Object(oldBundle);
        }
        if (key === "assets/newhash456.bundle" && newBundle) {
          return createR2Object(newBundle);
        }
        return null;
      },
      put: async (key: string, body: unknown) => {
        putCalls.push({ key, body });
      },
    },
    PATCH_MAX_BUNDLE_SIZE: overrides?.maxBundleSize ?? "4194304",
    PATCH_MIN_SAVING: overrides?.minSaving ?? "0.8",
  } as unknown as Env;

  return { env, putCalls, runCalls };
};

// -- Tests --------------------------------------------------------------------

describe(handlePatchMessage, () => {
  const message = { oldHash: "oldhash123", newHash: "newhash456" };

  beforeEach(() => {
    mockPatchRatio = 0.2;
  });

  test("skips when patch already exists (idempotent)", async () => {
    const { env, putCalls } = createMockEnv({ existingPatch: true });

    await handlePatchMessage(message, env);

    expect(putCalls).toHaveLength(0);
  });

  test("returns gracefully when bundle is missing from R2", async () => {
    const { env, putCalls } = createMockEnv({ oldBundle: null });

    await handlePatchMessage(message, env);

    expect(putCalls).toHaveLength(0);
  });

  test("skips when bundle exceeds PATCH_MAX_BUNDLE_SIZE", async () => {
    const largeBundle = new Uint8Array(5_000_000);
    const { env, putCalls } = createMockEnv({
      oldBundle: largeBundle,
      maxBundleSize: "4194304",
    });

    await handlePatchMessage(message, env);

    expect(putCalls).toHaveLength(0);
  });

  test("discards patch when ratio check fails (patch >= 80% of new)", async () => {
    // Patch = 1000 * 1 = 1000 bytes; threshold = 0.8 * 1200 = 960; 1000 >= 960 -> discard
    mockPatchRatio = 1;

    const { env, putCalls } = createMockEnv({ minSaving: "0.8" });

    await handlePatchMessage(message, env);

    expect(putCalls).toHaveLength(0);
  });

  test("stores patch in R2 and inserts into D1 on happy path", async () => {
    const { env, putCalls, runCalls } = createMockEnv();

    await handlePatchMessage(message, env);

    // Patch was written to R2
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]!.key).toBe("patches/oldhash123/newhash456.patch");

    // D1 INSERT was called
    const insertCall = runCalls.find((call) => call.query.includes("INSERT"));
    expect(insertCall).toBeDefined();
    expect(insertCall!.bindings[0]).toBe("oldhash123");
    expect(insertCall!.bindings[1]).toBe("newhash456");
  });
});
