import { env } from "cloudflare:test";

import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { del, get, parseCookies, post } = setupE2EWorker(".wrangler/state/e2e-roles");

// ── Cross-flow: built-in role RBAC boundaries + custom (dynamic-AC) roles ──
//
// Exercises L1 (static RBAC: developer/viewer are now first-class assignable via
// the better-auth org API — the old raw-D1 `UPDATE member.role` hack is gone) and
// L2 (dynamic custom roles created through `/api/roles` then assigned via
// `update-member-role`). The owner bootstraps an org + project, invites members at
// each built-in role, and proves the gate boundaries end-to-end through the full
// middleware + handler stack.

const PASSWORD = "SecureP@ss123";

// Invite a member at a given role, sign them up, verify their email (TEST_MODE
// leaves email_verified=0, which the org plugin blocks from accepting invites),
// accept the invitation, and activate the org. Returns the member's session
// cookies + their member-row id. Mirrors the bootstrap in org-members-flow +
// vault-flow.
const onboardMember = async (params: {
  readonly ownerCookies: string;
  readonly organizationId: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
}): Promise<{ readonly cookies: string; readonly memberId: string }> => {
  const invite = await post(
    "/api/auth/organization/invite-member",
    { email: params.email, role: params.role, organizationId: params.organizationId },
    { cookie: params.ownerCookies },
  );
  expect(invite.status).toBe(200);

  const invitationsRes = await get(
    `/api/auth/organization/list-invitations?organizationId=${params.organizationId}`,
    { cookie: params.ownerCookies },
  );
  const invitationsBody = await invitationsRes.json();
  const invitations = Array.isArray(invitationsBody)
    ? invitationsBody
    : (invitationsBody.invitations ?? invitationsBody);
  const invitation = invitations.find(
    (item: { email: string; status: string }) =>
      item.email === params.email && item.status === "pending",
  );
  expect(invitation).toBeDefined();

  const signup = await post("/api/auth/sign-up/email", {
    name: params.name,
    email: params.email,
    password: PASSWORD,
  });
  expect(signup.status).toBe(200);

  await env.DB.prepare(`UPDATE "user" SET "email_verified" = 1 WHERE "email" = ?`)
    .bind(params.email)
    .run();
  let cookies = parseCookies(
    await post("/api/auth/sign-in/email", { email: params.email, password: PASSWORD }),
  );

  const accept = await post(
    "/api/auth/organization/accept-invitation",
    { invitationId: invitation.id },
    { cookie: cookies },
  );
  expect(accept.status).toBe(200);

  cookies =
    parseCookies(
      await post(
        "/api/auth/organization/set-active",
        { organizationId: params.organizationId },
        { cookie: cookies },
      ),
    ) || cookies;

  const membersRes = await get(
    `/api/auth/organization/list-members?organizationId=${params.organizationId}`,
    { cookie: params.ownerCookies },
  );
  const membersBody = await membersRes.json();
  const members = Array.isArray(membersBody) ? membersBody : (membersBody.members ?? membersBody);
  const member = members.find((m: { user: { email: string } }) => m.user.email === params.email);
  expect(member).toBeDefined();

  return { cookies, memberId: member.id };
};

describe("Roles cross-flow (built-in RBAC + custom roles)", () => {
  let ownerCookies: string;
  let organizationId: string;
  let projectId: string;
  let channelId: string;
  let mainBranchId: string;

  // ── Section 1: Owner bootstrap ─────────────────────────────────

  it("owner signs up, creates an org + project, and a channel", async () => {
    const signup = await post("/api/auth/sign-up/email", {
      name: "Roles Owner",
      email: "roles-owner@example.com",
      password: PASSWORD,
    });
    expect(signup.status).toBe(200);
    ownerCookies = parseCookies(signup);

    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Roles Org", slug: "roles-org" },
      { cookie: ownerCookies },
    );
    expect(orgRes.status).toBe(200);
    organizationId = (await orgRes.json()).id;
    ownerCookies = parseCookies(orgRes) || ownerCookies;

    const active = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: ownerCookies },
    );
    expect(active.status).toBe(200);
    ownerCookies = parseCookies(active) || ownerCookies;

    const projectRes = await post(
      "/api/projects",
      { name: "Roles Project", slug: "roles-project" },
      { cookie: ownerCookies },
    );
    expect(projectRes.status).toBe(201);
    projectId = (await projectRes.json()).id;

    const branchRes = await post(
      "/api/branches",
      { projectId, name: "roles-main" },
      { cookie: ownerCookies },
    );
    expect(branchRes.status).toBe(201);
    mainBranchId = (await branchRes.json()).id;

    const channelRes = await post(
      "/api/channels",
      { projectId, name: "roles-channel", branchId: mainBranchId },
      { cookie: ownerCookies },
    );
    expect(channelRes.status).toBe(201);
    channelId = (await channelRes.json()).id;
  });

  // ── Section 2: developer built-in role boundaries ──────────────
  // developer: project [read,create] (NO delete); channel [read,create,update,delete].

  let devCookies: string;

  it("invites Bob as developer via the better-auth org API (no raw D1)", async () => {
    const onboarded = await onboardMember({
      ownerCookies,
      organizationId,
      name: "Dev Bob",
      email: "roles-dev@example.com",
      role: "developer",
    });
    devCookies = onboarded.cookies;
  });

  it("developer can create a channel (channel:create granted)", async () => {
    // `branchId` is required on create — the developer makes its own branch first
    // (branch:create is in the developer map).
    const branchRes = await post(
      "/api/branches",
      { projectId, name: "dev-branch" },
      { cookie: devCookies },
    );
    expect(branchRes.status).toBe(201);
    const devBranchId = (await branchRes.json()).id;

    const res = await post(
      "/api/channels",
      { projectId, name: "dev-created-channel", branchId: devBranchId },
      { cookie: devCookies },
    );
    expect(res.status).toBe(201);
    expect((await res.json()).name).toBe("dev-created-channel");
  });

  it("developer cannot delete the project (project:delete denied → 403)", async () => {
    const res = await del(`/api/projects/${projectId}`, { cookie: devCookies });
    expect(res.status).toBe(403);
  });

  // ── Section 3: viewer built-in role boundaries ─────────────────
  // viewer: read-only everywhere; no channel:create.

  let viewerCookies: string;

  it("invites Carol as viewer", async () => {
    const onboarded = await onboardMember({
      ownerCookies,
      organizationId,
      name: "Viewer Carol",
      email: "roles-viewer@example.com",
      role: "viewer",
    });
    viewerCookies = onboarded.cookies;
  });

  it("viewer can list channels (channel:read granted)", async () => {
    const res = await get(`/api/channels?projectId=${projectId}`, { cookie: viewerCookies });
    expect(res.status).toBe(200);
    expect((await res.json()).items.length).toBeGreaterThan(0);
  });

  it("viewer cannot create a channel (channel:create denied → 403)", async () => {
    // The viewer cannot create a branch either, so reuse the owner's branch; the
    // gate trips on channel:create before any branch lookup matters.
    const res = await post(
      "/api/channels",
      { projectId, name: "viewer-channel", branchId: mainBranchId },
      { cookie: viewerCookies },
    );
    expect(res.status).toBe(403);
  });

  // ── Section 4: custom (dynamic-AC) role create + assign ─────────

  let roleId: string;
  let daveCookies: string;
  let daveMemberId: string;

  it("owner creates a custom 'releaser' role via /api/roles (201)", async () => {
    const res = await post(
      "/api/roles",
      {
        name: "releaser",
        permissions: [
          { resource: "channel", actions: ["read", "update"] },
          { resource: "rollout", actions: ["read", "create", "update"] },
        ],
      },
      { cookie: ownerCookies },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.role).toBe("releaser");
    expect(body.id).toBeDefined();
    roleId = body.id;
  });

  it("the custom role appears in GET /api/roles for the owner", async () => {
    const res = await get(`/api/roles?organizationId=${organizationId}`, { cookie: ownerCookies });
    expect(res.status).toBe(200);
    const roles = await res.json();
    expect(roles.some((role: { role: string }) => role.role === "releaser")).toBe(true);
  });

  it("owner onboards Dave and assigns the custom 'releaser' role", async () => {
    const onboarded = await onboardMember({
      ownerCookies,
      organizationId,
      name: "Releaser Dave",
      email: "roles-releaser@example.com",
      role: "member",
    });
    daveCookies = onboarded.cookies;
    daveMemberId = onboarded.memberId;

    const assign = await post(
      "/api/auth/organization/update-member-role",
      { memberId: daveMemberId, role: "releaser", organizationId },
      { cookie: ownerCookies },
    );
    expect(assign.status).toBe(200);
  });

  it("Dave (releaser) can update a channel (channel:update granted by custom role)", async () => {
    // pause/resume both gate channel:update (SPEC §9h) — a deterministic probe of
    // the custom role's channel:update without the PATCH-relink rollout constraint.
    const pause = await post(`/api/channels/${channelId}/pause`, {}, { cookie: daveCookies });
    expect(pause.status).toBe(200);
    expect((await pause.json()).isPaused).toBe(true);

    const resume = await post(`/api/channels/${channelId}/resume`, {}, { cookie: daveCookies });
    expect(resume.status).toBe(200);
    expect((await resume.json()).isPaused).toBe(false);
  });

  it("Dave (releaser) cannot delete a channel (channel:delete NOT in custom role → 403)", async () => {
    const res = await del(`/api/channels/${channelId}`, { cookie: daveCookies });
    expect(res.status).toBe(403);
  });

  it("Dave (releaser) cannot manage roles (ac:read NOT in custom role → 403)", async () => {
    const res = await get(`/api/roles?organizationId=${organizationId}`, { cookie: daveCookies });
    expect(res.status).toBe(403);
  });

  // ── Section 5: ac-resource gate on the roles surface ───────────

  it("viewer Carol cannot list roles (ac:read denied → 403)", async () => {
    const res = await get(`/api/roles?organizationId=${organizationId}`, { cookie: viewerCookies });
    expect(res.status).toBe(403);
  });

  it("viewer Carol cannot create a role (ac:create denied → 403)", async () => {
    const res = await post(
      "/api/roles",
      { name: "sneaky", permissions: [{ resource: "channel", actions: ["read"] }] },
      { cookie: viewerCookies },
    );
    expect(res.status).toBe(403);
  });

  it("owner can delete the custom role (ac:delete granted)", async () => {
    const res = await del(`/api/roles/${roleId}`, { cookie: ownerCookies });
    // The role is still assigned to Dave; better-auth may refuse deleting an
    // in-use role (Conflict) — re-assign Dave off it, then delete.
    if (res.status === 200) {
      expect((await res.json()).deleted).toBe(1);
      return;
    }
    expect(res.status).toBe(409);
    const reassign = await post(
      "/api/auth/organization/update-member-role",
      { memberId: daveMemberId, role: "viewer", organizationId },
      { cookie: ownerCookies },
    );
    expect(reassign.status).toBe(200);
    const retry = await del(`/api/roles/${roleId}`, { cookie: ownerCookies });
    expect(retry.status).toBe(200);
    expect((await retry.json()).deleted).toBe(1);
  });
});
