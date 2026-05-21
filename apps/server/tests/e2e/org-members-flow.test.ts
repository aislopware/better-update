import { env } from "cloudflare:test";

import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { get, parseCookies, post } = setupE2EWorker(".wrangler/state/e2e-members");

// ── Cross-flow: auth → org → invite → accept → members CRUD ─────

describe("Organization members cross-flow", () => {
  let cookiesA: string;
  let cookiesB: string;
  let organizationId: string;
  let invitationId: string;
  let memberBId: string;

  // ── Section 1: User A signup + org creation ────────────────────

  it("user A registers and creates an org", async () => {
    const signupRes = await post("/api/auth/sign-up/email", {
      name: "Owner Alice",
      email: "alice@example.com",
      password: "SecureP@ss123",
    });
    expect(signupRes.status).toBe(200);
    cookiesA = parseCookies(signupRes);

    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Alice Org", slug: "alice-org" },
      { cookie: cookiesA },
    );
    expect(orgRes.status).toBe(200);
    const orgBody = await orgRes.json();
    organizationId = orgBody.id;
    cookiesA = parseCookies(orgRes) || cookiesA;

    const setActiveRes = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookiesA },
    );
    expect(setActiveRes.status).toBe(200);
    cookiesA = parseCookies(setActiveRes) || cookiesA;
  });

  // ── Section 2: Invite user B ───────────────────────────────────

  it("user A invites user B by email", async () => {
    const res = await post(
      "/api/auth/organization/invite-member",
      { email: "bob@example.com", role: "member", organizationId },
      { cookie: cookiesA },
    );
    expect(res.status).toBe(200);
  });

  it("invitation appears in pending list", async () => {
    const res = await get(
      `/api/auth/organization/list-invitations?organizationId=${organizationId}`,
      { cookie: cookiesA },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const invitations = Array.isArray(body) ? body : (body.invitations ?? body);
    const pending = invitations.find(
      (i: { email: string; status: string }) =>
        i.email === "bob@example.com" && i.status === "pending",
    );
    expect(pending).toBeDefined();
    invitationId = pending.id;
  });

  // ── Section 3: User B signup + accept invitation ───────────────

  it("user B registers with the invited email", async () => {
    const res = await post("/api/auth/sign-up/email", {
      name: "Member Bob",
      email: "bob@example.com",
      password: "SecureP@ss123",
    });
    expect(res.status).toBe(200);

    // Production users sign in through GitHub OAuth with a pre-verified email;
    // the email/password test path leaves email_verified=0, which better-auth's
    // org plugin blocks from accepting invitations. Verify in D1, then re-sign-in
    // so the refreshed session (compact cookie cache) carries the verified state.
    await env.DB.prepare(`UPDATE "user" SET "email_verified" = 1 WHERE "email" = ?`)
      .bind("bob@example.com")
      .run();
    const signin = await post("/api/auth/sign-in/email", {
      email: "bob@example.com",
      password: "SecureP@ss123",
    });
    expect(signin.status).toBe(200);
    cookiesB = parseCookies(signin);
  });

  it("user B accepts the invitation", async () => {
    const res = await post(
      "/api/auth/organization/accept-invitation",
      { invitationId },
      { cookie: cookiesB },
    );
    expect(res.status).toBe(200);
  });

  // ── Section 4: Verify member list ──────────────────────────────

  it("member list shows both users", async () => {
    const res = await get(`/api/auth/organization/list-members?organizationId=${organizationId}`, {
      cookie: cookiesA,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const members = Array.isArray(body) ? body : (body.members ?? body);
    expect(members).toHaveLength(2);

    const bob = members.find(
      (m: { user: { email: string } }) => m.user.email === "bob@example.com",
    );
    expect(bob).toBeDefined();
    expect(bob.role).toBe("member");
    memberBId = bob.id;
  });

  // ── Section 5: Role management ─────────────────────────────────

  it("user A promotes user B to admin", async () => {
    const res = await post(
      "/api/auth/organization/update-member-role",
      { memberId: memberBId, role: "admin", organizationId },
      { cookie: cookiesA },
    );
    expect(res.status).toBe(200);
  });

  it("user B role is now admin", async () => {
    const res = await get(`/api/auth/organization/list-members?organizationId=${organizationId}`, {
      cookie: cookiesA,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const members = Array.isArray(body) ? body : (body.members ?? body);
    const bob = members.find(
      (m: { user: { email: string } }) => m.user.email === "bob@example.com",
    );
    expect(bob.role).toBe("admin");
  });

  // ── Section 6: Remove member ───────────────────────────────────

  it("user A removes user B from org", async () => {
    const res = await post(
      "/api/auth/organization/remove-member",
      { memberIdOrEmail: memberBId, organizationId },
      { cookie: cookiesA },
    );
    expect(res.status).toBe(200);
  });

  it("member list shows only user A", async () => {
    const res = await get(`/api/auth/organization/list-members?organizationId=${organizationId}`, {
      cookie: cookiesA,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const members = Array.isArray(body) ? body : (body.members ?? body);
    expect(members).toHaveLength(1);
    expect(members[0].user.email).toBe("alice@example.com");
  });
});
