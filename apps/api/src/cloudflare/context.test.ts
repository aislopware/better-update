import { getCtx, getEnv, setRequestContext } from "./context";

describe("Cloudflare request context", () => {
  test("setRequestContext stores env and ctx", () => {
    const mockEnv = { DB: {}, SESSION_KV: {} } as unknown as Env;
    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;

    setRequestContext(mockEnv, mockCtx);

    expect(getEnv()).toBe(mockEnv);
    expect(getCtx()).toBe(mockCtx);
  });
});
