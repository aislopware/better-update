import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { get, post } = setupE2EWorker(".wrangler/state/e2e");

describe("Health & docs", () => {
  it("GET /api/auth/ok returns 200", async () => {
    const response = await get("/api/auth/ok");
    expect(response.status).toBe(200);
  });
});

describe("Unauthenticated access", () => {
  it("GET /api/projects returns 401", async () => {
    const response = await get("/api/projects");
    expect(response.status).toBe(401);
  });

  it("POST /api/projects returns 401", async () => {
    const response = await post("/api/projects", { name: "test", slug: "test-app" });
    expect(response.status).toBe(401);
  });
});

describe("Auth flow (full happy path)", () => {
  it("registers a new user", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Test User",
      email: "test@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user?.email).toBe("test@example.com");
  });

  it("signs in and receives session cookie", async () => {
    const response = await post("/api/auth/sign-in/email", {
      email: "test@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user?.email).toBe("test@example.com");
    expect(body.token ?? response.headers.getSetCookie().join("; ")).toBeDefined();
  });

  it("rejects invalid credentials", async () => {
    const response = await post("/api/auth/sign-in/email", {
      email: "test@example.com",
      password: "wrongpassword",
    });
    expect(response.status).not.toBe(200);
  });
});
