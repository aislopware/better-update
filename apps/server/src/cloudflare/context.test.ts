import { Effect } from "effect";

import { cloudflareCtx, cloudflareEnv, setRequestContext } from "./context";

describe("Cloudflare request context", () => {
  test("setRequestContext stores env and ctx", () => {
    const mockEnv = { DB: {}, SESSION_KV: {} } as unknown as Env;
    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;

    setRequestContext(mockEnv, mockCtx);

    expect(Effect.runSync(cloudflareEnv)).toBe(mockEnv);
    expect(Effect.runSync(cloudflareCtx)).toBe(mockCtx);
  });
});
