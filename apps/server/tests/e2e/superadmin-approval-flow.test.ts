import { env } from "cloudflare:test";

import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { get, post, postNoBody, parseCookies } = setupE2EWorker(".wrangler/state/e2e-superadmin");

// Test-mode sign-ups are auto-approved (see auth.ts databaseHooks). We drive the
// gate deterministically by toggling `approved`/`role` straight in D1, mirroring
// the org-role e2e pattern — the middleware reads both fresh from D1 per request.
const setApproved = async (userId: string, approved: boolean): Promise<void> => {
  await env.DB.prepare(`UPDATE "user" SET "approved" = ? WHERE "id" = ?`)
    .bind(approved ? 1 : 0, userId)
    .run();
};

const setRole = async (userId: string, role: string): Promise<void> => {
  await env.DB.prepare(`UPDATE "user" SET "role" = ? WHERE "id" = ?`).bind(role, userId).run();
};

const signUp = async (name: string, email: string) => {
  const response = await post("/api/auth/sign-up/email", {
    name,
    email,
    password: "SecureP@ss123",
  });
  expect(response.status).toBe(200);
  const body = await response.json();
  return { userId: body.user.id as string, cookies: parseCookies(response) };
};

const createOrgAndActivate = async (cookies: string, name: string, slug: string) => {
  const orgResponse = await post(
    "/api/auth/organization/create",
    { name, slug },
    { cookie: cookies },
  );
  expect(orgResponse.status).toBe(200);
  const org = await orgResponse.json();
  const afterCreate = parseCookies(orgResponse) || cookies;
  const activeResponse = await post(
    "/api/auth/organization/set-active",
    { organizationId: org.id },
    { cookie: afterCreate },
  );
  expect(activeResponse.status).toBe(200);
  return parseCookies(activeResponse) || afterCreate;
};

describe("Approval gate", () => {
  let pendingUserId: string;
  let pendingCookies: string;

  it("registers a user, then holds an unapproved user out of the management API", async () => {
    const { userId, cookies } = await signUp("Pending User", "pending@example.com");
    pendingUserId = userId;
    pendingCookies = cookies;

    await setApproved(pendingUserId, false);

    const response = await get("/api/projects", { cookie: pendingCookies });
    expect(response.status).toBe(403);
  });

  it("blocks org creation for an unapproved user", async () => {
    const response = await post(
      "/api/auth/organization/create",
      { name: "Pending Org", slug: "pending-org" },
      { cookie: pendingCookies },
    );
    expect(response.status).not.toBe(200);
  });

  it("lets the user through once approved", async () => {
    await setApproved(pendingUserId, true);
    const cookies = await createOrgAndActivate(pendingCookies, "Approved Org", "approved-org");
    const response = await post(
      "/api/projects",
      { name: "P", slug: "approved-proj" },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
  });
});

describe("Superadmin admin API", () => {
  let superCookies: string;
  let targetUserId: string;

  it("lists users for a superadmin", async () => {
    const { userId, cookies } = await signUp("Super Admin", "super@example.com");
    await setRole(userId, "admin");
    superCookies = await createOrgAndActivate(cookies, "Super Org", "super-org");

    const response = await get("/api/admin/users", { cookie: superCookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(2);
  });

  it("rejects the admin API for a non-superadmin", async () => {
    const { cookies } = await signUp("Plain User", "plain@example.com");
    const orgCookies = await createOrgAndActivate(cookies, "Plain Org", "plain-org");
    const response = await get("/api/admin/users", { cookie: orgCookies });
    expect(response.status).toBe(403);
  });

  it("approves then revokes a user", async () => {
    const { userId } = await signUp("Target User", "target@example.com");
    targetUserId = userId;
    await setApproved(targetUserId, false);

    const approve = await postNoBody(`/api/admin/users/${targetUserId}/approve`, {
      cookie: superCookies,
    });
    expect(approve.status).toBe(200);
    expect((await approve.json()).approved).toBe(true);

    const revoke = await postNoBody(`/api/admin/users/${targetUserId}/revoke`, {
      cookie: superCookies,
    });
    expect(revoke.status).toBe(200);
    expect((await revoke.json()).approved).toBe(false);
  });

  it("returns 404 approving an unknown user", async () => {
    const response = await postNoBody("/api/admin/users/does-not-exist/approve", {
      cookie: superCookies,
    });
    expect(response.status).toBe(404);
  });
});
