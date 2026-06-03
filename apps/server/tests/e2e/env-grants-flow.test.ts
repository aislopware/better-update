import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";

import worker from "../../src";
import { credentialEnvelope } from "../helpers/credential-envelope";
import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { get, parseCookies, post, put } = setupE2EWorker(".wrangler/state/e2e-env-grants");

// ── Cross-flow: per (project × environment) ABAC env-var grants (L3, deny-wins) ──
//
// Env-var handlers gate org-wide with `assertPermission("envVar", action)`, then
// layer a per (project × environment) ABAC scope on top (`assertEnvVarScopedPermission`
// for single-row ops; `resolveEnvReadPredicate` for the list). A per-scope DENY
// grant subtracts ONE (project, environment) cell from a member who otherwise has
// the `envVar:read` baseline: their `production` rows vanish from the list
// (filtered silently) and a direct GET of a `production` var is a 403, while
// `development` + `preview` stay readable. A SECOND member with no grant is
// unaffected. Revoking the deny restores the cell. The grant-management endpoints
// are owner/admin-only (`member:update`). API-key principals (memberId === null)
// ignore grants entirely — they fall back to their metadata baseline (admin),
// so a standing member DENY does NOT touch the api key (SPEC §6.3, §7.5).
//
// Values are end-to-end encrypted: the server stores opaque sealed envelopes and
// never sees plaintext, so the create payloads use placeholder envelopes.

const PASSWORD = "SecureP@ss123";

const ENVIRONMENTS = ["development", "preview", "production"] as const;

// DELETE /api/env-grants carries a JSON body (`HttpApiEndpoint.del(...).setPayload`),
// which the shared `del` helper cannot send (it dispatches a bodiless DELETE).
// Mirror the worker-pool dispatch here: same `origin` header (better-auth's CSRF
// guard rejects state-changing cookie requests with no trusted Origin) and the
// same `waitOnExecutionContext` drain so background audit writes settle before
// the next request reads state.
const BASE = "http://localhost";

const delWithBody = async (
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<Response> => {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${BASE}${path}`, {
      method: "DELETE",
      headers: { "content-type": "application/json", origin: BASE, ...headers },
      body: JSON.stringify(body),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
};

// Create one project-scoped env var in a single environment. Returns its id so a
// later test can GET it directly (to assert the scoped read gate). The value is an
// opaque client-encrypted envelope — the server is zero-knowledge.
const createEnvVar = async (params: {
  readonly cookies: string;
  readonly projectId: string;
  readonly environment: (typeof ENVIRONMENTS)[number];
  readonly key: string;
}): Promise<string> => {
  const res = await post(
    "/api/env-vars",
    {
      scope: "project",
      projectId: params.projectId,
      environment: params.environment,
      key: params.key,
      visibility: "plaintext",
      value: credentialEnvelope(),
    },
    { cookie: params.cookies },
  );
  expect(res.status).toBe(201);
  return (await res.json()).id;
};

// Onboard a member at a built-in role and return their cookies + member-row id.
// Mirrors channel-grants-flow.test.ts: invite → accept → set-active, then read the
// member row id back from the owner's member list.
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

// Read the set of (key) names visible to `cookies` for one environment of the
// project, via the scope=project list (no environment filter would mix all three;
// we pin one environment to assert which cells survive the read predicate).
const listKeys = async (params: {
  readonly cookies: string;
  readonly projectId: string;
  readonly environment: (typeof ENVIRONMENTS)[number];
}): Promise<string[]> => {
  const res = await get(
    `/api/env-vars?projectId=${params.projectId}&scope=project&environments=${params.environment}`,
    { cookie: params.cookies },
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  return (body.items as { key: string }[]).map((item) => item.key);
};

describe("Env grants cross-flow (per project × environment ABAC, deny-wins)", () => {
  let ownerCookies: string;
  let organizationId: string;
  let projectId: string;

  // One var per environment so the list has a distinct row to filter per cell.
  let devVarId: string;
  let previewVarId: string;
  let productionVarId: string;

  // ── Section 1: Owner bootstrap + project + one env var per environment ──

  it("owner signs up, creates an org + project", async () => {
    const signup = await post("/api/auth/sign-up/email", {
      name: "Env Grants Owner",
      email: "env-grants-owner@example.com",
      password: PASSWORD,
    });
    expect(signup.status).toBe(200);
    ownerCookies = parseCookies(signup);

    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Env Grants Org", slug: "env-grants-org" },
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
      { name: "Env Grants Project", slug: "env-grants-project" },
      { cookie: ownerCookies },
    );
    expect(projectRes.status).toBe(201);
    projectId = (await projectRes.json()).id;
  });

  it("owner creates one env var in each of development / preview / production", async () => {
    devVarId = await createEnvVar({
      cookies: ownerCookies,
      projectId,
      environment: "development",
      key: "DEV_ONLY_TOKEN",
    });
    previewVarId = await createEnvVar({
      cookies: ownerCookies,
      projectId,
      environment: "preview",
      key: "PREVIEW_ONLY_TOKEN",
    });
    productionVarId = await createEnvVar({
      cookies: ownerCookies,
      projectId,
      environment: "production",
      key: "PROD_ONLY_TOKEN",
    });
    expect(previewVarId).not.toBe(devVarId);
    expect(productionVarId).not.toBe(previewVarId);
  });

  // ── Section 2: two members, both with the envVar:read baseline ──
  // developer baseline has envVar [read,create,update] but NO member:update — so
  // each can read env vars by baseline yet cannot manage grants (used in §6).

  let aliceCookies: string;
  let aliceMemberId: string;
  let bobCookies: string;
  let bobMemberId: string;

  it("invites Alice (member A) as a developer", async () => {
    const onboarded = await onboardMember({
      ownerCookies,
      organizationId,
      name: "Dev Alice",
      email: "env-grants-alice@example.com",
      role: "developer",
    });
    aliceCookies = onboarded.cookies;
    aliceMemberId = onboarded.memberId;
  });

  it("invites Bob (member B) as a developer", async () => {
    const onboarded = await onboardMember({
      ownerCookies,
      organizationId,
      name: "Dev Bob",
      email: "env-grants-bob@example.com",
      role: "developer",
    });
    bobCookies = onboarded.cookies;
    bobMemberId = onboarded.memberId;
  });

  // ── Section 3: baseline — Alice reads every environment before any grant ──

  it("Alice can list dev + preview + production rows by baseline (no grant yet)", async () => {
    expect(
      await listKeys({ cookies: aliceCookies, projectId, environment: "development" }),
    ).toEqual(["DEV_ONLY_TOKEN"]);
    expect(await listKeys({ cookies: aliceCookies, projectId, environment: "preview" })).toEqual([
      "PREVIEW_ONLY_TOKEN",
    ]);
    expect(await listKeys({ cookies: aliceCookies, projectId, environment: "production" })).toEqual(
      ["PROD_ONLY_TOKEN"],
    );
  });

  it("Alice can GET the production var directly by baseline (→ 200)", async () => {
    const res = await get(`/api/env-vars/${productionVarId}`, { cookie: aliceCookies });
    expect(res.status).toBe(200);
    expect((await res.json()).key).toBe("PROD_ONLY_TOKEN");
  });

  // ── Section 4: DENY envVar:read on (project, production) for Alice ──
  // Deny wins over Alice's baseline on production ONLY. dev + preview untouched.

  it("owner denies Alice envVar:read on (project, production)", async () => {
    const res = await put(
      "/api/env-grants",
      {
        memberId: aliceMemberId,
        projectId,
        environment: "production",
        effect: "deny",
        actions: ["envVar:read"],
      },
      { cookie: ownerCookies },
    );
    expect(res.status).toBe(200);
    const grant = await res.json();
    expect(grant.memberId).toBe(aliceMemberId);
    expect(grant.effect).toBe("deny");
    expect(grant.scopeKind).toBe("env_var_environment");
    expect(grant.scopeId).toBe(`${projectId}:production`);
    expect(grant.actions).toContain("envVar:read");
  });

  it("the deny grant appears in the env-grant list for this project scope", async () => {
    const res = await get(`/api/env-grants?projectId=${projectId}`, { cookie: ownerCookies });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as {
      memberId: string;
      environment: string;
      effect: string;
    }[];
    const row = rows.find(
      (entry) => entry.memberId === aliceMemberId && entry.environment === "production",
    );
    expect(row).toBeDefined();
    expect(row?.effect).toBe("deny");
  });

  it("Alice's production row is silently filtered out of the list (deny wins)", async () => {
    expect(await listKeys({ cookies: aliceCookies, projectId, environment: "production" })).toEqual(
      [],
    );
  });

  it("Alice still sees dev + preview rows (deny is production-scoped)", async () => {
    expect(
      await listKeys({ cookies: aliceCookies, projectId, environment: "development" }),
    ).toEqual(["DEV_ONLY_TOKEN"]);
    expect(await listKeys({ cookies: aliceCookies, projectId, environment: "preview" })).toEqual([
      "PREVIEW_ONLY_TOKEN",
    ]);
  });

  it("Alice's direct GET of the production var is now a 403 (scoped read gate)", async () => {
    const res = await get(`/api/env-vars/${productionVarId}`, { cookie: aliceCookies });
    expect(res.status).toBe(403);
  });

  it("Alice can still GET the dev + preview vars directly (→ 200)", async () => {
    const dev = await get(`/api/env-vars/${devVarId}`, { cookie: aliceCookies });
    expect(dev.status).toBe(200);
    const preview = await get(`/api/env-vars/${previewVarId}`, { cookie: aliceCookies });
    expect(preview.status).toBe(200);
  });

  // ── Section 5: Bob is unaffected — the grant is member-scoped to Alice ──

  it("Bob still sees the production row in the list (grant is Alice-scoped)", async () => {
    expect(await listKeys({ cookies: bobCookies, projectId, environment: "production" })).toEqual([
      "PROD_ONLY_TOKEN",
    ]);
  });

  it("Bob can still GET the production var directly (→ 200)", async () => {
    const res = await get(`/api/env-vars/${productionVarId}`, { cookie: bobCookies });
    expect(res.status).toBe(200);
  });

  // ── Section 6: management gating is owner/admin-only (member:update) ──

  it("developer Alice cannot manage env grants (lacks member:update → 403)", async () => {
    const res = await put(
      "/api/env-grants",
      {
        memberId: bobMemberId,
        projectId,
        environment: "production",
        effect: "deny",
        actions: ["envVar:read"],
      },
      { cookie: aliceCookies },
    );
    expect(res.status).toBe(403);
  });

  it("rejects a grant for a non-member id (anti-enumeration → 404)", async () => {
    const res = await put(
      "/api/env-grants",
      {
        memberId: crypto.randomUUID(),
        projectId,
        environment: "production",
        effect: "deny",
        actions: ["envVar:read"],
      },
      { cookie: ownerCookies },
    );
    expect(res.status).toBe(404);
  });

  // ── Section 7: revoke restores Alice's production access ──

  it("owner revokes Alice's deny grant on production", async () => {
    const res = await delWithBody(
      "/api/env-grants",
      { memberId: aliceMemberId, projectId, environment: "production" },
      { cookie: ownerCookies },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(1);
  });

  it("Alice's production row is visible again after the revoke (baseline restored)", async () => {
    expect(await listKeys({ cookies: aliceCookies, projectId, environment: "production" })).toEqual(
      ["PROD_ONLY_TOKEN"],
    );
    const res = await get(`/api/env-vars/${productionVarId}`, { cookie: aliceCookies });
    expect(res.status).toBe(200);
  });

  // ── Section 8: api-key actor ignores grants (baseline only, §6.3) ──
  // An api-key principal has memberId === null, so `resolveEnvReadPredicate` skips
  // the grant lookup and the scoped asserts resolve from the admin baseline. A
  // standing DENY grant for Alice on production does NOT touch the api key: it
  // still lists + gets the production var.

  let apiKeyValue: string;

  it("creates an API key for the org", async () => {
    const res = await post(
      "/api/auth/api-key/create",
      { name: "env-grants-test-key", organizationId },
      { cookie: ownerCookies },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toMatch(/^bu_/);
    apiKeyValue = body.key;
  });

  it("re-applies a deny grant for Alice on production (a member-scoped grant exists)", async () => {
    const res = await put(
      "/api/env-grants",
      {
        memberId: aliceMemberId,
        projectId,
        environment: "production",
        effect: "deny",
        actions: ["envVar:read"],
      },
      { cookie: ownerCookies },
    );
    expect(res.status).toBe(200);
  });

  it("api-key list of the production environment is UNAFFECTED by Alice's deny grant", async () => {
    const res = await get(
      `/api/env-vars?projectId=${projectId}&scope=project&environments=production`,
      { authorization: `Bearer ${apiKeyValue}` },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect((body.items as { key: string }[]).map((item) => item.key)).toEqual(["PROD_ONLY_TOKEN"]);
  });

  it("api-key direct GET of the production var is UNAFFECTED (grants ignored → 200)", async () => {
    const res = await get(`/api/env-vars/${productionVarId}`, {
      authorization: `Bearer ${apiKeyValue}`,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).key).toBe("PROD_ONLY_TOKEN");
  });
});
