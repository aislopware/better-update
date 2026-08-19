import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";

import worker from "../../src";
import { incomingRequest } from "../helpers/incoming-request";

describe("Projects API", () => {
  it("returns 401 without auth", async () => {
    const request = incomingRequest("http://localhost/api/projects");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
  });

  // Effect v4 matches the route before running the API's authentication
  // middleware, so an unknown path 404s instead of the 401 v3 produced. Nothing
  // leaks: the route table is already public at `/api/openapi.json` and `/docs`.
  it("returns 404 for unknown routes (routing runs before auth)", async () => {
    const request = incomingRequest("http://localhost/api/unknown");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(404);
  });
});

describe("Auth routes", () => {
  it("exposes Better Auth endpoints", async () => {
    const request = incomingRequest("http://localhost/api/auth/ok");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    // Better Auth /api/auth/ok returns 200 when server is healthy
    expect(response.status).toBe(200);
  });
});
