import { createHash } from "node:crypto";

import { env } from "cloudflare:test";

import { seedAssetObject, setupE2EWorker } from "../helpers/e2e-worker-pool";

const { del, get, parseCookies, post, postNoBody, put } = setupE2EWorker(
  ".wrangler/state/e2e-channel-grants",
);

// ── Cross-flow: per-channel ABAC grants (L3, deny-wins) ────────────
//
// A per-channel ALLOW grant lifts a viewer above their read-only baseline on ONE
// channel (publish to staging, not production). A per-channel DENY grant subtracts
// a single channel from a developer who otherwise has the baseline (blocked on
// production, still works on staging). Revoking the deny restores baseline. The
// grant-management endpoints are owner/admin-only (member:update). API-key
// principals (memberId === null) ignore grants entirely — they fall back to their
// metadata baseline (§7).
//
// New projects seed `production`/`staging`/`preview` branches + same-named
// channels; we publish with `branch: "<name>"`, which resolves to the seeded
// same-named channel, and grant on that channel's id.

const PASSWORD = "SecureP@ss123";

// One shared, finalized asset the publish payloads reference. The publish gate
// (`assertPermissionOn("update","create",…)`) runs AFTER asset-existence is
// checked, so a real uploaded+finalized asset is required to REACH the gate (and
// to let an authorized publish actually succeed).
const ASSET_CONTENT = "console.log('grant-flow')";
const ASSET_HASH = createHash("sha256").update(ASSET_CONTENT).digest("base64url");

const publishBody = (params: {
  readonly branch: string;
  readonly groupId: string;
  readonly runtimeVersion?: string;
}) => ({
  slug: "grants-project",
  branch: params.branch,
  runtimeVersion: params.runtimeVersion ?? "1.0.0",
  platform: "ios" as const,
  message: `publish to ${params.branch}`,
  groupId: params.groupId,
  metadata: {},
  assets: [{ hash: ASSET_HASH, key: "bundles/ios.js", isLaunch: true }],
});

// Onboard a member at a built-in role and return their cookies + member-row id.
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

describe("Channel grants cross-flow (per-channel ABAC)", () => {
  let ownerCookies: string;
  let organizationId: string;
  let projectId: string;
  let stagingChannelId: string;
  let productionChannelId: string;

  // ── Section 1: Owner bootstrap + seeded channels + shared asset ──

  it("owner signs up, creates an org + project, and resolves the seeded channels", async () => {
    const signup = await post("/api/auth/sign-up/email", {
      name: "Grants Owner",
      email: "grants-owner@example.com",
      password: PASSWORD,
    });
    expect(signup.status).toBe(200);
    ownerCookies = parseCookies(signup);

    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Grants Org", slug: "grants-org" },
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
      { name: "Grants Project", slug: "grants-project" },
      { cookie: ownerCookies },
    );
    expect(projectRes.status).toBe(201);
    projectId = (await projectRes.json()).id;

    const channelsRes = await get(`/api/channels?projectId=${projectId}`, { cookie: ownerCookies });
    expect(channelsRes.status).toBe(200);
    const channels = (await channelsRes.json()).items as { id: string; name: string }[];
    const staging = channels.find((c) => c.name === "staging");
    const production = channels.find((c) => c.name === "production");
    expect(staging).toBeDefined();
    expect(production).toBeDefined();
    stagingChannelId = staging!.id;
    productionChannelId = production!.id;
  });

  it("owner registers + finalizes the shared launch asset", async () => {
    const register = await post(
      "/api/assets/upload",
      {
        projectId,
        assets: [{ hash: ASSET_HASH, contentType: "application/javascript", fileExt: "js" }],
      },
      { cookie: ownerCookies },
    );
    expect(register.status).toBe(201);

    await seedAssetObject({
      hash: ASSET_HASH,
      content: ASSET_CONTENT,
      contentType: "application/javascript",
    });
    const finalize = await postNoBody(`/api/assets/${ASSET_HASH}/finalize`, {
      cookie: ownerCookies,
    });
    expect(finalize.status).toBe(200);
  });

  // ── Section 2: ALLOW grant lifts a viewer onto one channel ──────
  // viewer baseline lacks update:create everywhere. An ALLOW grant on staging
  // lets Eve publish there, but NOT on production.

  let eveCookies: string;
  let eveMemberId: string;

  it("invites Eve as a viewer", async () => {
    const onboarded = await onboardMember({
      ownerCookies,
      organizationId,
      name: "Viewer Eve",
      email: "grants-eve@example.com",
      role: "viewer",
    });
    eveCookies = onboarded.cookies;
    eveMemberId = onboarded.memberId;
  });

  it("viewer Eve cannot publish to staging yet (no grant, baseline read-only → 403)", async () => {
    const res = await post("/api/updates", publishBody({ branch: "staging", groupId: "eve-pre" }), {
      cookie: eveCookies,
    });
    expect(res.status).toBe(403);
  });

  it("owner grants Eve allow:[update:create,rollout:update] on staging", async () => {
    const res = await put(
      `/api/channels/${stagingChannelId}/grants/${eveMemberId}`,
      { effect: "allow", actions: ["update:create", "rollout:update"] },
      { cookie: ownerCookies },
    );
    expect(res.status).toBe(200);
    const grant = await res.json();
    expect(grant.memberId).toBe(eveMemberId);
    expect(grant.effect).toBe("allow");
    expect(grant.actions).toContain("update:create");
  });

  it("the grant appears in the channel's grant list", async () => {
    const res = await get(`/api/channels/${stagingChannelId}/grants`, { cookie: ownerCookies });
    expect(res.status).toBe(200);
    const grants = await res.json();
    expect(grants.some((g: { memberId: string }) => g.memberId === eveMemberId)).toBe(true);
  });

  it("viewer Eve can now publish to staging (allow grant lifts baseline → 201)", async () => {
    const res = await post(
      "/api/updates",
      publishBody({ branch: "staging", groupId: "eve-staging" }),
      { cookie: eveCookies },
    );
    expect(res.status).toBe(201);
    expect((await res.json()).id).toBeDefined();
  });

  it("viewer Eve still cannot publish to production (grant is staging-scoped → 403)", async () => {
    const res = await post(
      "/api/updates",
      publishBody({ branch: "production", groupId: "eve-prod" }),
      { cookie: eveCookies },
    );
    expect(res.status).toBe(403);
  });

  // ── Section 3: DENY grant subtracts one channel from a developer ─
  // developer baseline HAS update:create. A DENY grant on production blocks Frank
  // there (deny wins over baseline) while staging keeps working.

  let frankCookies: string;
  let frankMemberId: string;

  it("invites Frank as a developer", async () => {
    const onboarded = await onboardMember({
      ownerCookies,
      organizationId,
      name: "Dev Frank",
      email: "grants-frank@example.com",
      role: "developer",
    });
    frankCookies = onboarded.cookies;
    frankMemberId = onboarded.memberId;
  });

  it("developer Frank can publish to production by baseline (before any deny → 201)", async () => {
    const res = await post(
      "/api/updates",
      publishBody({ branch: "production", groupId: "frank-prod-pre", runtimeVersion: "2.0.0" }),
      { cookie: frankCookies },
    );
    expect(res.status).toBe(201);
  });

  it("owner grants Frank deny:[update:create] on production", async () => {
    const res = await put(
      `/api/channels/${productionChannelId}/grants/${frankMemberId}`,
      { effect: "deny", actions: ["update:create"] },
      { cookie: ownerCookies },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).effect).toBe("deny");
  });

  it("developer Frank can still publish to staging (no deny there → 201)", async () => {
    const res = await post(
      "/api/updates",
      publishBody({ branch: "staging", groupId: "frank-staging", runtimeVersion: "2.0.0" }),
      { cookie: frankCookies },
    );
    expect(res.status).toBe(201);
  });

  it("developer Frank can no longer publish to production (deny wins over baseline → 403)", async () => {
    const res = await post(
      "/api/updates",
      publishBody({ branch: "production", groupId: "frank-prod-denied", runtimeVersion: "3.0.0" }),
      { cookie: frankCookies },
    );
    expect(res.status).toBe(403);
  });

  // ── Section 4: revoke restores the baseline ─────────────────────

  it("owner revokes Frank's grant on production", async () => {
    const res = await del(`/api/channels/${productionChannelId}/grants/${frankMemberId}`, {
      cookie: ownerCookies,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(1);
  });

  it("developer Frank can publish to production again (baseline restored → 201)", async () => {
    const res = await post(
      "/api/updates",
      publishBody({
        branch: "production",
        groupId: "frank-prod-restored",
        runtimeVersion: "3.0.0",
      }),
      { cookie: frankCookies },
    );
    expect(res.status).toBe(201);
  });

  // ── Section 5: grant management is owner/admin-only (member:update) ─

  it("viewer Eve cannot manage grants (lacks member:update → 403)", async () => {
    const res = await put(
      `/api/channels/${stagingChannelId}/grants/${frankMemberId}`,
      { effect: "allow", actions: ["update:create"] },
      { cookie: eveCookies },
    );
    expect(res.status).toBe(403);
  });

  it("developer Frank cannot manage grants either (developer lacks member:update → 403)", async () => {
    const res = await put(
      `/api/channels/${stagingChannelId}/grants/${eveMemberId}`,
      { effect: "deny", actions: ["update:create"] },
      { cookie: frankCookies },
    );
    expect(res.status).toBe(403);
  });

  it("rejects a grant for a non-member id (anti-enumeration → 404)", async () => {
    const res = await put(
      `/api/channels/${stagingChannelId}/grants/${crypto.randomUUID()}`,
      { effect: "allow", actions: ["update:create"] },
      { cookie: ownerCookies },
    );
    expect(res.status).toBe(404);
  });

  // ── Section 6: API-key fallback — grants are ignored (§7) ───────
  // An api-key principal has no member id, so allow/deny grants never apply; it
  // falls back to its metadata baseline (admin). A standing DENY grant on a
  // channel for some member does NOT affect the api key.

  let apiKeyValue: string;

  it("creates an API key for the org", async () => {
    const res = await post(
      "/api/auth/api-key/create",
      { name: "grants-test-key", organizationId },
      { cookie: ownerCookies },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toMatch(/^bu_/);
    apiKeyValue = body.key;
  });

  it("re-applies a deny grant for Frank on production (a member-scoped grant exists)", async () => {
    const res = await put(
      `/api/channels/${productionChannelId}/grants/${frankMemberId}`,
      { effect: "deny", actions: ["update:create"] },
      { cookie: ownerCookies },
    );
    expect(res.status).toBe(200);
  });

  it("api-key publish to production is UNAFFECTED by the member deny grant (→ 201)", async () => {
    const res = await post(
      "/api/updates",
      publishBody({ branch: "production", groupId: "apikey-prod", runtimeVersion: "4.0.0" }),
      { authorization: `Bearer ${apiKeyValue}` },
    );
    expect(res.status).toBe(201);
  });
});
