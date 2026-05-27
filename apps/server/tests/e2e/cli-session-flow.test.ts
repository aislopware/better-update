import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { get, parseCookies, post } = setupE2EWorker(".wrangler/state/e2e-cli-session");

const rand = () => crypto.randomUUID();

// A freshly generated device identity, as the CLI would register it.
const deviceKeyBody = (label: string) => ({
  kind: "device" as const,
  publicKey: `age1${rand()}${rand()}`,
  label,
  fingerprint: `SHA256:${rand()}`,
});

// ── Browser→CLI handoff: cookie sign-in → one-time token → session bearer ──
//
// Regression coverage for the onboarding blocker. The CLI authenticates with a
// Bearer token; an API-key token carries no userId, so registering a user-owned
// `device` key failed with "Device keys require an interactive user session".
// The CLI now exchanges a one-time token for a real Better Auth session token
// (via the `bearer` + `oneTimeToken` plugins) and sends it as
// `Authorization: Bearer`, so its requests carry a real user.
describe("CLI session auth (bearer + one-time-token)", () => {
  let cookies: string;
  let organizationId: string;
  let sessionToken: string;

  it("signs up and activates an org over the browser cookie", async () => {
    const signup = await post("/api/auth/sign-up/email", {
      name: "CLI Session User",
      email: "cli-session-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(signup.status).toBe(200);
    cookies = parseCookies(signup);

    const org = await post(
      "/api/auth/organization/create",
      { name: "CLI Session Org", slug: "cli-session-org" },
      { cookie: cookies },
    );
    expect(org.status).toBe(200);
    organizationId = (await org.json()).id;
    cookies = parseCookies(org) || cookies;

    const active = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    expect(active.status).toBe(200);
    cookies = parseCookies(active) || cookies;
  });

  it("exchanges a one-time token for a session token via set-auth-token", async () => {
    const generated = await get("/api/auth/one-time-token/generate", { cookie: cookies });
    expect(generated.status).toBe(200);
    const { token } = await generated.json();
    expect(token).toBeTruthy();

    const verified = await post("/api/auth/one-time-token/verify", { token });
    expect(verified.status).toBe(200);
    const headerToken = verified.headers.get("set-auth-token");
    expect(headerToken).toBeTruthy();
    sessionToken = headerToken ?? "";
  });

  it("registers a device key over Authorization: Bearer with a real userId", async () => {
    const res = await post("/api/encryption-keys", deviceKeyBody("CLI laptop"), {
      authorization: `Bearer ${sessionToken}`,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.kind).toBe("device");
    // The bug this fixes: a bearer session resolves a real user, so userId is set
    // and the device key is user-owned (no organizationId).
    expect(body.userId).not.toBeNull();
    expect(body.organizationId).toBeNull();
  });

  it("still rejects a device key when the bearer token is an org API key (no user)", async () => {
    const created = await post(
      "/api/auth/api-key/create",
      { name: "ci-runner", organizationId },
      { cookie: cookies },
    );
    expect(created.status).toBe(200);
    const apiKey = (await created.json()).key as string;

    const res = await post("/api/encryption-keys", deviceKeyBody("CI runner"), {
      authorization: `Bearer ${apiKey}`,
    });
    expect(res.status).toBe(400);
  });
});
