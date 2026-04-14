import { Effect } from "effect";

import {
  cloudflareCtx,
  cloudflareEnv,
  cloudflareRequest,
  provideCloudflareRequestContext,
} from "./context";

describe("Cloudflare request context", () => {
  test("provideCloudflareRequestContext stores env and ctx", () => {
    const mockEnv = { DB: {}, SESSION_KV: {} } as unknown as Env;
    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    const mockRequest = new Request("https://example.com/manifest/test");

    expect(
      Effect.runSync(provideCloudflareRequestContext(cloudflareEnv, mockEnv, mockCtx, mockRequest)),
    ).toBe(mockEnv);
    expect(
      Effect.runSync(provideCloudflareRequestContext(cloudflareCtx, mockEnv, mockCtx, mockRequest)),
    ).toBe(mockCtx);
    expect(
      Effect.runSync(
        provideCloudflareRequestContext(cloudflareRequest, mockEnv, mockCtx, mockRequest),
      ),
    ).toBe(mockRequest);
  });
});
