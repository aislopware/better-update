import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";

import worker from "../../src";

const request = (url: string, init?: RequestInit) => {
  const req = new Request(`http://localhost${url}`, init);
  const ctx = createExecutionContext();
  return worker.fetch(req, env, ctx).then(async (response) => {
    await waitOnExecutionContext(ctx);
    return response;
  });
};

const jsonPost = (url: string, body: unknown) =>
  request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("Auth flow (Better Auth + D1)", () => {
  it("GET /api/auth/ok returns 200", async () => {
    const response = await request("/api/auth/ok");
    expect(response.status).toBe(200);
  });

  it("registers a new user via email/password", async () => {
    const response = await jsonPost("/api/auth/sign-up/email", {
      name: "Test User",
      email: "test@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user?.email).toBe("test@example.com");
  });

  it("signs in with email/password", async () => {
    const response = await jsonPost("/api/auth/sign-in/email", {
      email: "test@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user?.email).toBe("test@example.com");
    expect(body.token ?? response.headers.get("set-cookie")).toBeDefined();
  });

  it("rejects invalid credentials", async () => {
    const response = await jsonPost("/api/auth/sign-in/email", {
      email: "test@example.com",
      password: "wrongpassword",
    });
    expect(response.status).not.toBe(200);
  });
});
