import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";

import worker from "../../src";

describe("Projects API", () => {
  it("returns 401 without auth", async () => {
    const request = new Request("http://localhost/api/projects");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
  });

  it("returns 401 for unknown routes (auth runs before routing)", async () => {
    const request = new Request("http://localhost/api/unknown");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
  });
});

describe("Auth routes", () => {
  it("exposes Better Auth endpoints", async () => {
    const request = new Request("http://localhost/api/auth/ok");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    // Better Auth /api/auth/ok returns 200 when server is healthy
    expect(response.status).toBe(200);
  });
});
