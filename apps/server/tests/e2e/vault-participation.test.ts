import { toBase64 } from "@better-update/encoding";
import { env } from "cloudflare:test";

import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { del, get, parseCookies, patch, post } = setupE2EWorker(
  ".wrangler/state/e2e-vault-participation",
);

// ── Vault participation (non-admin self-service) ─────────────────
// Regression coverage for the GITLAB-RBAC v2 cutover: `vaultAccess:*` became
// an org-admin rule, but the vault SELF-SERVICE surfaces (enrolling one's own
// device key, self-link, fetching one's wrap) must stay open to any principal
// with ≥ developer on some project — humans (`identity create`) and robots
// (CI `env pull`) alike. Blobs are opaque to the server (zero-knowledge), so
// random base64 stands in for real crypto, as in vault-flow.test.ts.

const rand = () => crypto.randomUUID();
const opaque = () => toBase64(crypto.getRandomValues(new Uint8Array(48)));

const recipientBody = (kind: "device" | "recovery", label: string) => ({
  kind,
  publicKey: `age1${rand()}${rand()}`,
  label,
  fingerprint: `SHA256:${rand()}`,
});

const wrapFor = (userEncryptionKeyId: string) => ({ userEncryptionKeyId, wrappedKey: opaque() });

describe("Vault participation cross-flow", () => {
  let cookiesA: string;
  let cookiesB: string;
  let organizationId: string;
  let projectId: string;
  let memberBId: string;
  let deviceA: string;
  let deviceB: string;
  let deviceB2: string;
  let recovery: string;
  let machineKeyId: string;
  let robotBearer: string;

  // ── Section 1: owner org + project, member B joins ──────────────

  it("owner signs up, creates an org and a project", async () => {
    const signup = await post("/api/auth/sign-up/email", {
      name: "Vault Owner",
      email: "vp-owner@example.com",
      password: "SecureP@ss123",
    });
    expect(signup.status).toBe(200);
    cookiesA = parseCookies(signup);

    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "VP Org", slug: "vp-org" },
      { cookie: cookiesA },
    );
    expect(orgRes.status).toBe(200);
    organizationId = (await orgRes.json()).id;
    cookiesA = parseCookies(orgRes) || cookiesA;

    const active = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookiesA },
    );
    expect(active.status).toBe(200);
    cookiesA = parseCookies(active) || cookiesA;

    const projectRes = await post(
      "/api/projects",
      { name: "VP Project", slug: "vp-project" },
      { cookie: cookiesA },
    );
    expect(projectRes.status).toBe(201);
    projectId = (await projectRes.json()).id;
  });

  it("member B is invited and joins as a plain org member", async () => {
    const invite = await post(
      "/api/auth/organization/invite-member",
      { email: "vp-bob@example.com", role: "member", organizationId },
      { cookie: cookiesA },
    );
    expect(invite.status).toBe(200);

    const invitations = await get(
      `/api/auth/organization/list-invitations?organizationId=${organizationId}`,
      { cookie: cookiesA },
    );
    const invitationsBody = await invitations.json();
    const pendingList = Array.isArray(invitationsBody)
      ? invitationsBody
      : (invitationsBody.invitations ?? invitationsBody);
    const invitationId = pendingList.find(
      (invitation: { email: string; status: string }) =>
        invitation.email === "vp-bob@example.com" && invitation.status === "pending",
    ).id;

    const signup = await post("/api/auth/sign-up/email", {
      name: "Member Bob",
      email: "vp-bob@example.com",
      password: "SecureP@ss123",
    });
    expect(signup.status).toBe(200);
    // The email/password test path leaves email_verified=0, which better-auth's
    // org plugin blocks from accepting invitations — verify in D1 + re-sign-in
    // (same workaround as org-members-flow.test.ts).
    await env.DB.prepare(`UPDATE "user" SET "email_verified" = 1 WHERE "email" = ?`)
      .bind("vp-bob@example.com")
      .run();
    const signin = await post("/api/auth/sign-in/email", {
      email: "vp-bob@example.com",
      password: "SecureP@ss123",
    });
    expect(signin.status).toBe(200);
    cookiesB = parseCookies(signin);

    const accept = await post(
      "/api/auth/organization/accept-invitation",
      { invitationId },
      { cookie: cookiesB },
    );
    expect(accept.status).toBe(200);

    const active = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookiesB },
    );
    expect(active.status).toBe(200);
    cookiesB = parseCookies(active) || cookiesB;

    const members = await get(
      `/api/auth/organization/list-members?organizationId=${organizationId}`,
      { cookie: cookiesA },
    );
    const membersBody = await members.json();
    const memberList = Array.isArray(membersBody) ? membersBody : (membersBody.members ?? []);
    memberBId = memberList.find(
      (member: { user: { email: string } }) => member.user.email === "vp-bob@example.com",
    ).id;
  });

  // ── Section 2: participation gate on device-key enrolment ───────

  it("a member with NO project role cannot enroll a device key (escalation guard)", async () => {
    const res = await post("/api/encryption-keys", recipientBody("device", "Bob laptop"), {
      cookie: cookiesB,
    });
    expect(res.status).toBe(403);
  });

  it("a developer on some project CAN enroll a device key (`identity create`)", async () => {
    const grant = await post(
      `/api/projects/${projectId}/members`,
      { principalType: "member", principalId: memberBId, role: "developer" },
      { cookie: cookiesA },
    );
    expect(grant.status).toBe(201);

    const res = await post("/api/encryption-keys", recipientBody("device", "Bob laptop"), {
      cookie: cookiesB,
    });
    expect(res.status).toBe(201);
    deviceB = (await res.json()).id;
  });

  // ── Section 3: bootstrap + admin grant + member unlock ──────────

  it("owner bootstraps the vault and grants Bob's device", async () => {
    deviceA = (
      await (
        await post("/api/encryption-keys", recipientBody("device", "Owner laptop"), {
          cookie: cookiesA,
        })
      ).json()
    ).id;
    recovery = (
      await (
        await post("/api/encryption-keys", recipientBody("recovery", "Offline recovery"), {
          cookie: cookiesA,
        })
      ).json()
    ).id;

    const bootstrap = await post(
      "/api/vault",
      {
        wraps: [wrapFor(deviceA), wrapFor(recovery)],
        envWraps: [
          { recipientKind: "recovery", recipientId: recovery, wrappedKey: opaque() },
          { recipientKind: "device", recipientId: deviceA, wrappedKey: opaque() },
        ],
      },
      { cookie: cookiesA },
    );
    expect(bootstrap.status).toBe(201);

    const grant = await post(
      "/api/vault/wraps",
      { vaultVersion: 1, wrap: wrapFor(deviceB) },
      { cookie: cookiesA },
    );
    expect(grant.status).toBe(201);
  });

  it("the developer member fetches their own wrap (vault unlock)", async () => {
    const res = await get(`/api/vault/wraps/${deviceB}`, { cookie: cookiesB });
    expect(res.status).toBe(200);
    expect(typeof (await res.json()).wrappedKey).toBe("string");
  });

  it("the developer member self-links a second device (no admin needed)", async () => {
    const registered = await post("/api/encryption-keys", recipientBody("device", "Bob desktop"), {
      cookie: cookiesB,
    });
    expect(registered.status).toBe(201);
    deviceB2 = (await registered.json()).id;

    const res = await post(
      "/api/vault/wraps",
      { vaultVersion: 1, wrap: wrapFor(deviceB2) },
      { cookie: cookiesB },
    );
    expect(res.status).toBe(201);
  });

  // ── Section 4: robot (CI) participation via its project role ────

  it("a project robot fetches its wraps with its bearer (CI env pull path)", async () => {
    const robotRes = await post(
      "/api/robot-accounts",
      {
        name: "vp-ci",
        projectId,
        role: "developer",
        publicKey: `age1${rand()}${rand()}`,
        fingerprint: `SHA256:${rand()}`,
      },
      { cookie: cookiesA },
    );
    expect(robotRes.status).toBe(201);
    const robot = await robotRes.json();
    machineKeyId = robot.userEncryptionKeyId;
    robotBearer = robot.bearerSecret;

    const cvGrant = await post(
      "/api/vault/wraps",
      { vaultVersion: 1, wrap: wrapFor(machineKeyId) },
      { cookie: cookiesA },
    );
    expect(cvGrant.status).toBe(201);
    const envGrant = await post(
      "/api/env-vault/wraps",
      {
        envVaultVersion: 1,
        wrap: { recipientKind: "machine", recipientId: machineKeyId, wrappedKey: opaque() },
      },
      { cookie: cookiesA },
    );
    expect(envGrant.status).toBe(201);

    const bearer = { authorization: `Bearer ${robotBearer}` };
    const cvWrap = await get(`/api/vault/wraps/${machineKeyId}`, bearer);
    expect(cvWrap.status).toBe(200);
    const envWrap = await get(`/api/env-vault/wraps/machine/${machineKeyId}`, bearer);
    expect(envWrap.status).toBe(200);
  });

  // ── Section 5: downgrade to reporter strips participation ───────

  it("downgrading the member to reporter reconciles their wraps away", async () => {
    const downgrade = await patch(
      `/api/projects/${projectId}/members/${memberBId}`,
      { principalType: "member", role: "reporter" },
      { cookie: cookiesA },
    );
    expect(downgrade.status).toBe(200);

    // The gate closes first (403 before any wrap lookup) …
    const wrap = await get(`/api/vault/wraps/${deviceB}`, { cookie: cookiesB });
    expect(wrap.status).toBe(403);
    const enroll = await post("/api/encryption-keys", recipientBody("device", "Bob phone"), {
      cookie: cookiesB,
    });
    expect(enroll.status).toBe(403);

    // … and the reconcile dropped both of Bob's wraps + flagged rotation.
    const wraps = await get("/api/vault/wraps", { cookie: cookiesA });
    const recipientIds = ((await wraps.json()).recipients as { userEncryptionKeyId: string }[]).map(
      (recipient) => recipient.userEncryptionKeyId,
    );
    expect(recipientIds).not.toContain(deviceB);
    expect(recipientIds).not.toContain(deviceB2);
    const vault = await get("/api/vault", { cookie: cookiesA });
    expect((await vault.json()).rotationPending).toBe(true);
  });

  it("removing the reporter row entirely keeps the gate closed", async () => {
    const remove = await del(
      `/api/projects/${projectId}/members/${memberBId}?principalType=member`,
      { cookie: cookiesA },
    );
    expect(remove.status).toBe(200);

    const res = await post("/api/encryption-keys", recipientBody("device", "Bob tablet"), {
      cookie: cookiesB,
    });
    expect(res.status).toBe(403);
  });
});
