import { env } from "cloudflare:test";

import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { del, get, parseCookies, post } = setupE2EWorker(".wrangler/state/e2e-policy-authz");

// ── IAM Policy + Group authorization cross-flow E2E ───────────────
//
// Asserts the whole object-scoped policy chain end-to-end against the real
// worker (full middleware + assertAccess gate) on local D1:
//   - owner (Alice) creates two projects A and B,
//   - a real policy scoped to project A (allow channel:* + project:read) is
//     attached to a GROUP,
//   - a plain `member` (Bob) is added to that group,
//   - Bob can create/mutate a channel in project A but is DENIED in project B,
//   - the owner is never locked out (can act in BOTH projects),
//   - a robot account with no policy attachment is denied (default-deny).
//
// Bob's better-auth member role is `member` (NOT admin/developer/viewer), so he
// carries NO managed-preset baseline — every grant he has flows solely from the
// scoped policy attached via the group. That is exactly what we want to prove.
//
// Single file → two robot accounts issued (one for the default-deny check, one
// via the IAM endpoint), each used for ≤1 authed request — well within the
// 120 req/60s per-robot limit.

describe("IAM Policy + Group authorization cross-flow", () => {
  let aliceCookies: string;
  let bobCookies: string;
  let organizationId: string;
  let projectAId: string;
  let projectBId: string;
  let branchAId: string;
  let branchBId: string;
  let bobMemberId: string;
  let groupId: string;
  let policyId: string;
  let robotBearer: string;
  let bobRobotAccountPolicyId: string;
  let bobMintedRobotId: string;
  let bobMintedRobotBearer: string;
  let bobInvitationPolicyId: string;
  let bobInvitationId: string;
  let aliceMemberId: string;
  let bobMemberDeletePolicyId: string;

  // ── Section 1: Owner bootstrap + two projects ──────────────────

  it("owner Alice signs up, creates an org, and sets it active", async () => {
    const signup = await post("/api/auth/sign-up/email", {
      name: "Owner Alice",
      email: "alice-authz@example.com",
      password: "SecureP@ss123",
    });
    expect(signup.status).toBe(200);
    aliceCookies = parseCookies(signup);

    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Authz Org", slug: "authz-org" },
      { cookie: aliceCookies },
    );
    expect(orgRes.status).toBe(200);
    organizationId = (await orgRes.json()).id;
    aliceCookies = parseCookies(orgRes) || aliceCookies;

    const setActive = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: aliceCookies },
    );
    expect(setActive.status).toBe(200);
    aliceCookies = parseCookies(setActive) || aliceCookies;
  });

  it("owner creates project A and project B", async () => {
    const projectA = await post(
      "/api/projects",
      { name: "Project A", slug: "project-a" },
      { cookie: aliceCookies },
    );
    expect(projectA.status).toBe(201);
    projectAId = (await projectA.json()).id;

    const projectB = await post(
      "/api/projects",
      { name: "Project B", slug: "project-b" },
      { cookie: aliceCookies },
    );
    expect(projectB.status).toBe(201);
    projectBId = (await projectB.json()).id;
  });

  it("owner resolves a seeded branch in each project (used to create channels)", async () => {
    const branchesA = await get(`/api/branches?projectId=${projectAId}`, { cookie: aliceCookies });
    expect(branchesA.status).toBe(200);
    const branchABody = await branchesA.json();
    expect(branchABody.items.length).toBeGreaterThan(0);
    branchAId = branchABody.items[0].id;

    const branchesB = await get(`/api/branches?projectId=${projectBId}`, { cookie: aliceCookies });
    expect(branchesB.status).toBe(200);
    const branchBBody = await branchesB.json();
    expect(branchBBody.items.length).toBeGreaterThan(0);
    branchBId = branchBBody.items[0].id;
  });

  // ── Section 2: Invite Bob as a plain member ────────────────────

  it("owner invites Bob; Bob signs up, verifies, and accepts", async () => {
    const invite = await post(
      "/api/auth/organization/invite-member",
      { email: "bob-authz@example.com", role: "member", organizationId },
      { cookie: aliceCookies },
    );
    expect(invite.status).toBe(200);

    const invitations = await get(
      `/api/auth/organization/list-invitations?organizationId=${organizationId}`,
      { cookie: aliceCookies },
    );
    const invBody = await invitations.json();
    const list = Array.isArray(invBody) ? invBody : (invBody.invitations ?? invBody);
    const pending = list.find(
      (inv: { email: string; status: string }) =>
        inv.email === "bob-authz@example.com" && inv.status === "pending",
    );
    expect(pending).toBeDefined();
    const invitationId = pending.id;

    const bobSignup = await post("/api/auth/sign-up/email", {
      name: "Member Bob",
      email: "bob-authz@example.com",
      password: "SecureP@ss123",
    });
    expect(bobSignup.status).toBe(200);

    // email/password path leaves email_verified=0; the org plugin blocks accept.
    // Verify in D1 then re-sign-in so the refreshed session carries it.
    await env.DB.prepare(`UPDATE "user" SET "email_verified" = 1 WHERE "email" = ?`)
      .bind("bob-authz@example.com")
      .run();
    const bobSignin = await post("/api/auth/sign-in/email", {
      email: "bob-authz@example.com",
      password: "SecureP@ss123",
    });
    expect(bobSignin.status).toBe(200);
    bobCookies = parseCookies(bobSignin);

    const accept = await post(
      "/api/auth/organization/accept-invitation",
      { invitationId },
      { cookie: bobCookies },
    );
    expect(accept.status).toBe(200);

    const setActive = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: bobCookies },
    );
    expect(setActive.status).toBe(200);
    bobCookies = parseCookies(setActive) || bobCookies;
  });

  it("owner resolves Bob's member id", async () => {
    const members = await get(
      `/api/auth/organization/list-members?organizationId=${organizationId}`,
      { cookie: aliceCookies },
    );
    expect(members.status).toBe(200);
    const body = await members.json();
    const list = Array.isArray(body) ? body : (body.members ?? body);
    const bob = list.find(
      (member: { user: { email: string } }) => member.user.email === "bob-authz@example.com",
    );
    expect(bob).toBeDefined();
    expect(bob.role).toBe("member");
    bobMemberId = bob.id;
  });

  // ── Section 3: Baseline — plain member is denied before any grant ─

  it("Bob (plain member, no policy yet) is DENIED creating a channel in project A", async () => {
    const res = await post(
      "/api/channels",
      { projectId: projectAId, name: "bob-early", branchId: branchAId },
      { cookie: bobCookies },
    );
    expect(res.status).toBe(403);
  });

  // ── Section 4: Owner builds the scoped policy + group + membership ─

  it("owner creates a policy scoped to project A (allow channel:* + project:read)", async () => {
    const res = await post(
      "/api/policies",
      {
        name: "project-a-channels",
        description: "Allow channel ops scoped to project A only",
        document: {
          statements: [
            {
              effect: "allow",
              actions: ["channel:create", "channel:read", "channel:update", "project:read"],
              resources: [`project/${projectAId}`],
            },
          ],
        },
      },
      { cookie: aliceCookies },
    );
    expect(res.status).toBe(201);
    policyId = (await res.json()).id;
  });

  it("owner creates a group and attaches the scoped policy to it", async () => {
    const groupRes = await post(
      "/api/groups",
      { name: "project-a-team", description: "Members scoped to project A" },
      { cookie: aliceCookies },
    );
    expect(groupRes.status).toBe(201);
    groupId = (await groupRes.json()).id;

    const attachRes = await post(
      `/api/groups/${groupId}/policies`,
      { policyId },
      { cookie: aliceCookies },
    );
    expect(attachRes.status).toBe(201);
    const attachment = await attachRes.json();
    expect(attachment.policyId).toBe(policyId);
    expect(attachment.principalType).toBe("group");
    expect(attachment.principalId).toBe(groupId);
  });

  it("owner adds Bob to the group", async () => {
    const res = await post(
      `/api/groups/${groupId}/members`,
      { memberId: bobMemberId },
      { cookie: aliceCookies },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.memberId).toBe(bobMemberId);
  });

  // ── Section 5: Object-scoped enforcement for Bob ───────────────

  it("Bob can now create a channel in project A (granted via group policy)", async () => {
    const res = await post(
      "/api/channels",
      { projectId: projectAId, name: "bob-stable", branchId: branchAId },
      { cookie: bobCookies },
    );
    expect(res.status).toBe(201);
    const channel = await res.json();
    expect(channel.name).toBe("bob-stable");
    expect(channel.projectId).toBe(projectAId);
  });

  it("Bob is DENIED creating a channel in project B (policy is scoped to project A)", async () => {
    const res = await post(
      "/api/channels",
      { projectId: projectBId, name: "bob-forbidden", branchId: branchBId },
      { cookie: bobCookies },
    );
    expect(res.status).toBe(403);
  });

  // ── Section 6: Owner is never locked out ───────────────────────

  it("owner can create channels in BOTH project A and project B (root bypass)", async () => {
    const inA = await post(
      "/api/channels",
      { projectId: projectAId, name: "owner-in-a", branchId: branchAId },
      { cookie: aliceCookies },
    );
    expect(inA.status).toBe(201);

    const inB = await post(
      "/api/channels",
      { projectId: projectBId, name: "owner-in-b", branchId: branchBId },
      { cookie: aliceCookies },
    );
    expect(inB.status).toBe(201);
  });

  // ── Section 7: robot account with no attachment is denied ──────

  it("a robot account with NO granting policy is denied (default-deny)", async () => {
    // Per POLICY-GROUPS-SPEC.md §8, a robot principal derives ALL permissions
    // from policy attachments (resolved like a member's) — a robot with none has
    // NO access. No attachment is seeded, so every guarded action is
    // default-denied. There is NO implicit admin baseline. Alice is the owner, so
    // minting itself succeeds (robotAccount:create + vaultAccess:create bypass).
    const robotRes = await post(
      "/api/robot-accounts",
      {
        name: "authz-e2e-robot",
        publicKey: `age1${crypto.randomUUID()}${crypto.randomUUID()}`,
        fingerprint: `SHA256:${crypto.randomUUID()}`,
      },
      { cookie: aliceCookies },
    );
    expect(robotRes.status).toBe(201);
    const robotBody = await robotRes.json();
    robotBearer = robotBody.bearerSecret;
    expect(robotBearer).toBeTruthy();

    // The robot carries no grants → effectiveStatements is empty → 403 on a
    // guarded read. (Bearer auth is exempt from the cookie CSRF origin guard.)
    const res = await get(`/api/channels?projectId=${projectAId}`, {
      authorization: `Bearer ${robotBearer}`,
    });
    expect(res.status).toBe(403);
  });

  // ── Section 7b: a NON-OWNER mints a robot account via the IAM endpoint ─
  //
  // The headline of the unification slice: robot account minting is no longer
  // better-auth owner-only — a plain member holding a `robotAccount:create`
  // grant (via policy attachment) can mint through POST /api/robot-accounts,
  // which gates on assertAccess("robotAccount", …) — plus vaultAccess:create,
  // since minting always registers the linked machine vault identity too.

  it("Bob (no robotAccount grant) is DENIED minting via the IAM endpoint", async () => {
    const res = await post(
      "/api/robot-accounts",
      {
        name: "bob-denied-robot",
        publicKey: `age1${crypto.randomUUID()}${crypto.randomUUID()}`,
        fingerprint: `SHA256:${crypto.randomUUID()}`,
      },
      { cookie: bobCookies },
    );
    expect(res.status).toBe(403);
  });

  it("owner grants Bob an org-scoped robotAccount + vaultAccess policy", async () => {
    const policyRes = await post(
      "/api/policies",
      {
        name: "org-robot-accounts",
        description: "Allow robot account management org-wide",
        document: {
          statements: [
            {
              effect: "allow",
              actions: [
                "robotAccount:create",
                "robotAccount:read",
                "robotAccount:delete",
                "vaultAccess:create",
              ],
              resources: ["*"],
            },
          ],
        },
      },
      { cookie: aliceCookies },
    );
    expect(policyRes.status).toBe(201);
    bobRobotAccountPolicyId = (await policyRes.json()).id;

    const attachRes = await post(
      `/api/groups/${groupId}/policies`,
      { policyId: bobRobotAccountPolicyId },
      { cookie: aliceCookies },
    );
    expect(attachRes.status).toBe(201);
  });

  it("Bob (non-owner) can now mint a robot account via IAM — POST /api/robot-accounts → 201", async () => {
    const res = await post(
      "/api/robot-accounts",
      {
        name: "bob-iam-robot",
        publicKey: `age1${crypto.randomUUID()}${crypto.randomUUID()}`,
        fingerprint: `SHA256:${crypto.randomUUID()}`,
      },
      { cookie: bobCookies },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    bobMintedRobotId = body.id;
    bobMintedRobotBearer = body.bearerSecret;
    expect(bobMintedRobotBearer).toBeTruthy();
    expect(bobMintedRobotBearer.startsWith("bu_robot_")).toBe(true);
  });

  it("the IAM-minted robot is a REAL verifiable bearer (403 not 401 on a guarded read)", async () => {
    // The minted robot principal has no policy attachment → default-deny → 403.
    // A 403 (authenticated-but-forbidden), NOT 401 (invalid bearer), proves
    // `RobotAccountRepo.verifyBearer` accepted our self-minted row.
    const res = await get(`/api/channels?projectId=${projectAId}`, {
      authorization: `Bearer ${bobMintedRobotBearer}`,
    });
    expect(res.status).toBe(403);
  });

  it("Bob can revoke the robot he minted (robotAccount:delete) — DELETE /api/robot-accounts/:id → 200", async () => {
    const res = await del(`/api/robot-accounts/${bobMintedRobotId}`, { cookie: bobCookies });
    expect(res.status).toBe(200);
  });

  // ── Section 7c: a NON-OWNER manages invitations via the IAM endpoint ─
  //
  // Invitation create/cancel/list moved off better-auth's org-role AC onto IAM
  // (POST/GET/DELETE /api/invitations gated by assertAccess("invitation", …)).
  // accept-invitation stays on better-auth and consumes the rows we write.

  it("Bob (no invitation grant) is DENIED POST /api/invitations", async () => {
    const res = await post(
      "/api/invitations",
      { email: "invitee-authz@example.com", role: "member" },
      { cookie: bobCookies },
    );
    expect(res.status).toBe(403);
  });

  it("owner grants Bob an org-scoped invitation policy (create/read/cancel on *)", async () => {
    const policyRes = await post(
      "/api/policies",
      {
        name: "org-invitations",
        description: "Allow invitation management org-wide",
        document: {
          statements: [
            {
              effect: "allow",
              actions: ["invitation:create", "invitation:read", "invitation:cancel"],
              resources: ["*"],
            },
          ],
        },
      },
      { cookie: aliceCookies },
    );
    expect(policyRes.status).toBe(201);
    bobInvitationPolicyId = (await policyRes.json()).id;

    const attachRes = await post(
      `/api/groups/${groupId}/policies`,
      { policyId: bobInvitationPolicyId },
      { cookie: aliceCookies },
    );
    expect(attachRes.status).toBe(201);
  });

  it("Bob (non-owner) can now create + list an invitation via IAM", async () => {
    const createRes = await post(
      "/api/invitations",
      { email: "invitee-authz@example.com", role: "member" },
      { cookie: bobCookies },
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    bobInvitationId = created.id;
    expect(created.status).toBe("pending");

    const listRes = await get("/api/invitations", { cookie: bobCookies });
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.items.some((inv: { id: string }) => inv.id === bobInvitationId)).toBe(true);
  });

  it("inviting role 'owner' is rejected (anti-escalation; InvitableRole is member-only)", async () => {
    const res = await post(
      "/api/invitations",
      { email: "escalate-authz@example.com", role: "owner" },
      { cookie: bobCookies },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("Bob can cancel the invitation he created — DELETE /api/invitations/:id → 200", async () => {
    const res = await del(`/api/invitations/${bobInvitationId}`, { cookie: bobCookies });
    expect(res.status).toBe(200);
  });

  // ── Section 7d: a NON-OWNER removes members via the IAM endpoint ─
  //
  // Member removal moved off better-auth's org-role AC onto IAM (DELETE
  // /api/members/:id gated by assertAccess("member","delete")). A role-"member"
  // principal who holds member:delete VIA A POLICY ATTACHMENT (not a role) passes
  // the gate — proving the collapse's headline: admin-ness is a policy, not a role.

  it("Bob (no member:delete grant) is DENIED removing a member via IAM", async () => {
    const members = await get(
      `/api/auth/organization/list-members?organizationId=${organizationId}`,
      { cookie: aliceCookies },
    );
    const body = await members.json();
    const list = Array.isArray(body) ? body : (body.members ?? body);
    const alice = list.find(
      (member: { user: { email: string } }) => member.user.email === "alice-authz@example.com",
    );
    expect(alice).toBeDefined();
    aliceMemberId = alice.id;

    const res = await del(`/api/members/${aliceMemberId}`, { cookie: bobCookies });
    expect(res.status).toBe(403);
  });

  it("owner grants Bob an org-scoped member:delete policy", async () => {
    const policyRes = await post(
      "/api/policies",
      {
        name: "org-member-delete",
        description: "Allow member removal org-wide",
        document: {
          statements: [{ effect: "allow", actions: ["member:delete"], resources: ["*"] }],
        },
      },
      { cookie: aliceCookies },
    );
    expect(policyRes.status).toBe(201);
    bobMemberDeletePolicyId = (await policyRes.json()).id;

    const attachRes = await post(
      `/api/groups/${groupId}/policies`,
      { policyId: bobMemberDeletePolicyId },
      { cookie: aliceCookies },
    );
    expect(attachRes.status).toBe(201);
  });

  it("Bob (member:delete via policy) now PASSES the gate; the last-owner guard returns 409", async () => {
    // A 409 (not 403) proves the gate was passed — Bob's member:delete came from
    // the policy attachment, not a role — and the last-owner guard then blocked
    // removing the sole owner. (The owner-path 200 remove is covered in
    // org-members-flow; the gate-allows-member:delete-holder path in members.test.)
    const res = await del(`/api/members/${aliceMemberId}`, { cookie: bobCookies });
    expect(res.status).toBe(409);
  });

  // ── Section 8: detach revokes Bob's access ─────────────────────

  it("detaching the policy from the group revokes Bob's project A access", async () => {
    const detach = await del(`/api/groups/${groupId}/policies/${policyId}`, {
      cookie: aliceCookies,
    });
    expect(detach.status).toBe(200);

    const res = await post(
      "/api/channels",
      { projectId: projectAId, name: "bob-after-detach", branchId: branchAId },
      { cookie: bobCookies },
    );
    expect(res.status).toBe(403);
  });
});
