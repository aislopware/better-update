import { Effect } from "effect";

import { provideCloudflareRequestContext } from "./context";
import { WorkersCache, WorkersCacheLive } from "./workers-cache";

// purgeTags guards are what make the port safe to call unconditionally from
// delete handlers: it must no-op (never die, never reject the request) when
// there is nothing to purge, when Workers Cache is not enabled for the runtime
// (local dev / vitest-pool-workers have no ctx.cache), and when the purge API
// itself rejects (shared zone rate limiter).

const mockEnv = { DB: { withSession: () => ({}) } } as unknown as Env;
const mockRequest = new Request("https://example.com/api/projects/p-1");

const makeCtx = (cache?: { readonly purge: (options: unknown) => Promise<unknown> }) => {
  const waited: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      waited.push(promise);
    },
    passThroughOnException: () => {},
    ...(cache ? { cache } : {}),
  } as unknown as ExecutionContext;
  return { ctx, waited };
};

const runPurge = async (tags: readonly string[], ctx: ExecutionContext) =>
  Effect.runPromise(
    provideCloudflareRequestContext(
      Effect.gen(function* () {
        const workersCache = yield* WorkersCache;
        yield* workersCache.purgeTags(tags);
      }).pipe(Effect.provide(WorkersCacheLive)),
      mockEnv,
      ctx,
      mockRequest,
    ),
  );

describe("WorkersCacheLive purgeTags", () => {
  it("no-ops on an empty tag list", async () => {
    const purge = vi.fn<(options: unknown) => Promise<unknown>>(async () => ({}));
    const { ctx, waited } = makeCtx({ purge });
    await runPurge([], ctx);
    expect(purge).not.toHaveBeenCalled();
    expect(waited).toHaveLength(0);
  });

  it("no-ops when the runtime has no ctx.cache (Workers Cache disabled)", async () => {
    const { ctx, waited } = makeCtx();
    await runPurge(["project:p-1"], ctx);
    expect(waited).toHaveLength(0);
  });

  it("detaches the purge via waitUntil with the given tags", async () => {
    const purge = vi.fn<(options: unknown) => Promise<unknown>>(async () => ({}));
    const { ctx, waited } = makeCtx({ purge });
    await runPurge(["project:p-1", "update:u-1"], ctx);
    expect(purge).toHaveBeenCalledWith({ tags: ["project:p-1", "update:u-1"] });
    expect(waited).toHaveLength(1);
    await waited[0];
  });

  it("swallows a rejected purge (best-effort by design)", async () => {
    const purge = vi.fn<(options: unknown) => Promise<unknown>>(async () => {
      throw new Error("rate limited");
    });
    const { ctx, waited } = makeCtx({ purge });
    await runPurge(["update:u-1"], ctx);
    // The detached promise must already carry its catch — awaiting it must not throw.
    await expect(waited[0]).resolves.toBeUndefined();
  });
});
