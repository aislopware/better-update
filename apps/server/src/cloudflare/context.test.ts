import { Effect } from "effect";

import { cloudflareCtx, cloudflareEnv, provideCloudflareRequestContext } from "./context";

describe("Cloudflare request context", () => {
  test("provideCloudflareRequestContext stores env and ctx", () => {
    const mockEnv = { DB: {}, SESSION_KV: {} } as unknown as Env;
    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;

    expect(Effect.runSync(provideCloudflareRequestContext(cloudflareEnv, mockEnv, mockCtx))).toBe(
      mockEnv,
    );
    expect(Effect.runSync(provideCloudflareRequestContext(cloudflareCtx, mockEnv, mockCtx))).toBe(
      mockCtx,
    );
  });
});
