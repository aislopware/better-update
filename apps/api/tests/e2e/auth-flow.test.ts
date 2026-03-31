import { execSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";

import { unstable_startWorker } from "wrangler";

let worker: Awaited<ReturnType<typeof unstable_startWorker>>;
let baseUrl: string;

const persistDir = ".wrangler/state/e2e";
const devVarsPath = ".dev.vars";

const devVars = `BETTER_AUTH_SECRET=e2e-test-secret-that-is-at-least-32-chars
BETTER_AUTH_URL=http://localhost
GITHUB_CLIENT_ID=e2e-github-id
GITHUB_CLIENT_SECRET=e2e-github-secret
`;

beforeAll(async () => {
  rmSync(persistDir, { recursive: true, force: true });
  writeFileSync(devVarsPath, devVars);

  execSync(`bunx wrangler d1 migrations apply DB --local --persist-to ${persistDir}`, {
    stdio: "pipe",
  });

  worker = await unstable_startWorker({
    config: "wrangler.jsonc",
    dev: {
      server: { port: 0 },
      inspector: false,
      persist: persistDir,
    },
  });
  const url = await worker.url;
  baseUrl = url.href.replace(/\/$/, "");
});

afterAll(async () => {
  await worker?.dispose();
  rmSync(persistDir, { recursive: true, force: true });
  rmSync(devVarsPath, { force: true });
});

describe("Health & docs", () => {
  it("GET /api/auth/ok returns 200", async () => {
    const response = await fetch(`${baseUrl}/api/auth/ok`);
    expect(response.status).toBe(200);
  });
});

describe("Unauthenticated access", () => {
  it("GET /api/projects returns 401", async () => {
    const response = await fetch(`${baseUrl}/api/projects`);
    expect(response.status).toBe(401);
  });

  it("POST /api/projects returns 401", async () => {
    const response = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "test", scopeKey: "@test/app" }),
    });
    expect(response.status).toBe(401);
  });
});

describe("Auth flow (full happy path)", () => {
  it("registers a new user", async () => {
    const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Test User",
        email: "test@example.com",
        password: "SecureP@ss123",
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user?.email).toBe("test@example.com");
  });

  it("signs in and receives session cookie", async () => {
    const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        password: "SecureP@ss123",
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user?.email).toBe("test@example.com");
    expect(body.token ?? response.headers.get("set-cookie")).toBeDefined();
  });

  it("rejects invalid credentials", async () => {
    const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        password: "wrongpassword",
      }),
    });
    expect(response.status).not.toBe(200);
  });
});
