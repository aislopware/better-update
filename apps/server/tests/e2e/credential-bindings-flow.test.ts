import { credentialEnvelope } from "../helpers/credential-envelope";
import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { del, get, parseCookies, post, put } = setupE2EWorker(".wrangler/state/e2e-cred-bindings");

const TEAM = "BINDT12345";

// ── Credential→project bindings E2E (GITLAB-RBAC-SPEC §1a/§3c) ────
//
// The v2 rule end-to-end: an org credential is usable in a project only when
// bound to it. Covers the auto-bind-at-upload path, the admin bind/unbind
// routes, per-robot visibility (a project-scoped robot sees exactly the
// credentials bound to ITS project), and the ascApiKey team-conflict guard.

describe("Credential bindings flow", () => {
  let cookies: string;
  let projectAId: string;
  let projectBId: string;
  let appleTeamRowId: string;
  let certId: string;
  let teamAscKeyId: string;
  let robotBBearer: string;

  it("bootstraps org + two projects", async () => {
    const signup = await post("/api/auth/sign-up/email", {
      name: "Bindings User",
      email: "bindings-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(signup.status).toBe(200);
    cookies = parseCookies(signup);

    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Bindings Org", slug: "bindings-org" },
      { cookie: cookies },
    );
    expect(orgRes.status).toBe(200);
    const organizationId = (await orgRes.json()).id;
    cookies = parseCookies(orgRes) || cookies;

    const activeRes = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    expect(activeRes.status).toBe(200);
    cookies = parseCookies(activeRes) || cookies;

    for (const [name, slug] of [
      ["Bind A", "bind-a"],
      ["Bind B", "bind-b"],
    ] as const) {
      const projRes = await post("/api/projects", { name, slug }, { cookie: cookies });
      expect(projRes.status).toBe(201);
      const id = (await projRes.json()).id;
      if (slug === "bind-a") {
        projectAId = id;
      } else {
        projectBId = id;
      }
    }
  });

  it("uploading a cert with projectId auto-binds the Apple team to project A", async () => {
    const certRes = await post(
      "/api/apple/distribution-certificates",
      {
        ...credentialEnvelope(),
        serialNumber: "SN-BIND-1",
        appleTeamIdentifier: TEAM,
        appleTeamName: "Bind Team",
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2028-01-01T00:00:00Z",
        projectId: projectAId,
      },
      { cookie: cookies },
    );
    expect(certRes.status).toBe(201);
    const cert = await certRes.json();
    appleTeamRowId = cert.appleTeamId;
    certId = cert.id;

    const listRes = await get(`/api/projects/${projectAId}/credential-bindings`, {
      cookie: cookies,
    });
    expect(listRes.status).toBe(200);
    const bindings = (await listRes.json()).items;
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      projectId: projectAId,
      resourceType: "appleTeam",
      resourceId: appleTeamRowId,
    });

    // The team row surfaces its bound projects.
    const teamsRes = await get("/api/apple-teams", { cookie: cookies });
    expect(teamsRes.status).toBe(200);
    const team = (await teamsRes.json()).items.find(
      (item: { id: string }) => item.id === appleTeamRowId,
    );
    expect(team.boundProjectIds).toStrictEqual([projectAId]);
  });

  it("a robot on project B does not see project A's credentials", async () => {
    const robotRes = await post(
      "/api/robot-accounts",
      {
        name: "bind-robot-b",
        projectId: projectBId,
        role: "maintainer",
        publicKey: "age1e2efixturebindingsrobot",
        fingerprint: "SHA256:e2e-fixture-bindings-robot",
      },
      { cookie: cookies },
    );
    expect(robotRes.status).toBe(201);
    robotBBearer = (await robotRes.json()).bearerSecret;

    const teamsRes = await get("/api/apple-teams", {
      authorization: `Bearer ${robotBBearer}`,
    });
    expect(teamsRes.status).toBe(200);
    expect((await teamsRes.json()).items).toHaveLength(0);

    const certsRes = await get("/api/apple/distribution-certificates", {
      authorization: `Bearer ${robotBBearer}`,
    });
    expect(certsRes.status).toBe(200);
    expect((await certsRes.json()).items).toHaveLength(0);
  });

  it("admin binds the team to project B via the route; the robot now sees it", async () => {
    const bindRes = await put(
      `/api/projects/${projectBId}/credential-bindings/appleTeam/${appleTeamRowId}`,
      {},
      { cookie: cookies },
    );
    expect(bindRes.status).toBe(201);
    const binding = await bindRes.json();
    expect(binding.resourceType).toBe("appleTeam");
    expect(binding.projectId).toBe(projectBId);

    // Idempotent: re-binding returns the same row, not a conflict.
    const again = await put(
      `/api/projects/${projectBId}/credential-bindings/appleTeam/${appleTeamRowId}`,
      {},
      { cookie: cookies },
    );
    expect(again.status).toBe(201);
    expect((await again.json()).id).toBe(binding.id);

    const teamsRes = await get("/api/apple-teams", {
      authorization: `Bearer ${robotBBearer}`,
    });
    const items = (await teamsRes.json()).items;
    expect(items).toHaveLength(1);
    expect([...items[0].boundProjectIds].sort()).toStrictEqual([projectAId, projectBId].sort());

    const certsRes = await get("/api/apple/distribution-certificates", {
      authorization: `Bearer ${robotBBearer}`,
    });
    expect((await certsRes.json()).items).toHaveLength(1);
  });

  it("a robot cannot manage bindings (org administration)", async () => {
    const res = await put(
      `/api/projects/${projectBId}/credential-bindings/appleTeam/${appleTeamRowId}`,
      {},
      { authorization: `Bearer ${robotBBearer}` },
    );
    expect(res.status).toBe(403);
  });

  it("unbind removes access again; a missing binding 404s", async () => {
    const unbindRes = await del(
      `/api/projects/${projectBId}/credential-bindings/appleTeam/${appleTeamRowId}`,
      { cookie: cookies },
    );
    expect(unbindRes.status).toBe(200);
    expect((await unbindRes.json()).deleted).toBe(1);

    const again = await del(
      `/api/projects/${projectBId}/credential-bindings/appleTeam/${appleTeamRowId}`,
      { cookie: cookies },
    );
    expect(again.status).toBe(404);

    const teamsRes = await get("/api/apple-teams", {
      authorization: `Bearer ${robotBBearer}`,
    });
    expect((await teamsRes.json()).items).toHaveLength(0);
  });

  it("a team-scoped ASC key cannot be bound directly (bind the team instead)", async () => {
    const ascRes = await post(
      "/api/apple/asc-api-keys",
      {
        ...credentialEnvelope(),
        name: "Bind ASC",
        keyId: "BINDASC123",
        issuerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        appleTeamIdentifier: TEAM,
      },
      { cookie: cookies },
    );
    expect(ascRes.status).toBe(201);
    teamAscKeyId = (await ascRes.json()).id;

    const bindRes = await put(
      `/api/projects/${projectAId}/credential-bindings/ascApiKey/${teamAscKeyId}`,
      {},
      { cookie: cookies },
    );
    expect(bindRes.status).toBe(409);
  });

  it("a team-less ASC key binds individually and stays maintainer-gated", async () => {
    const ascRes = await post(
      "/api/apple/asc-api-keys",
      {
        ...credentialEnvelope(),
        name: "Teamless ASC",
        keyId: "LONEASC123",
        issuerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        projectId: projectBId,
      },
      { cookie: cookies },
    );
    expect(ascRes.status).toBe(201);
    const teamlessId = (await ascRes.json()).id;

    const listRes = await get(`/api/projects/${projectBId}/credential-bindings`, {
      cookie: cookies,
    });
    const bindings = (await listRes.json()).items;
    expect(
      bindings.some(
        (item: { resourceType: string; resourceId: string }) =>
          item.resourceType === "ascApiKey" && item.resourceId === teamlessId,
      ),
    ).toBe(true);

    // Robot B is MAINTAINER on project B → team-less (always protected) key
    // bound to B is visible to it.
    const keysRes = await get("/api/apple/asc-api-keys", {
      authorization: `Bearer ${robotBBearer}`,
    });
    const visibleIds = ((await keysRes.json()).items as { id: string }[]).map((k) => k.id);
    expect(visibleIds).toContain(teamlessId);
    expect(visibleIds).not.toContain(teamAscKeyId);
  });

  it("every binding mutation left an audit entry — including auto-binds, minus idempotent re-PUTs", async () => {
    const auditRes = await get("/api/audit-logs?resourceType=credentialBinding", {
      cookie: cookies,
    });
    expect(auditRes.status).toBe(200);
    const entries = (await auditRes.json()).items as {
      action: string;
      resourceId: string | null;
      metadata: string | null;
    }[];

    const teamEntries = entries.filter((entry) => entry.resourceId === appleTeamRowId);
    // Exactly two creates: the auto-bind at upload (project A) and the manual
    // route bind (project B). The idempotent re-PUT added NO third entry.
    const creates = teamEntries.filter((entry) => entry.action === "credentialBinding.create");
    expect(creates).toHaveLength(2);
    const parsed = creates.map(
      (entry) => JSON.parse(entry.metadata ?? "{}") as { projectId: string; auto?: boolean },
    );
    expect(parsed.find((meta) => meta.projectId === projectAId)?.auto).toBe(true);
    expect(parsed.find((meta) => meta.projectId === projectBId)?.auto).toBeUndefined();
    expect(teamEntries.filter((entry) => entry.action === "credentialBinding.delete")).toHaveLength(
      1,
    );
  });

  it("config writes reject credential ids that do not exist in the org", async () => {
    const res = await post(
      `/api/projects/${projectAId}/ios-bundle-configurations`,
      {
        bundleIdentifier: "com.bind.badref",
        distributionType: "APP_STORE",
        appleTeamId: appleTeamRowId,
        appleDistributionCertificateId: "00000000-0000-0000-0000-000000000000",
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(404);
  });

  it("the binding plan derives what configs rely on, and is org-admin-only", async () => {
    const configRes = await post(
      `/api/projects/${projectAId}/ios-bundle-configurations`,
      {
        bundleIdentifier: "com.bind.plan",
        distributionType: "APP_STORE",
        appleTeamId: appleTeamRowId,
        appleDistributionCertificateId: certId,
      },
      { cookie: cookies },
    );
    expect(configRes.status).toBe(201);

    const planRes = await get("/api/credential-bindings/plan", { cookie: cookies });
    expect(planRes.status).toBe(200);
    const items = (await planRes.json()).items as {
      projectId: string;
      resourceType: string;
      resourceId: string;
      alreadyBound: boolean;
    }[];
    const teamItem = items.find(
      (item) => item.resourceType === "appleTeam" && item.resourceId === appleTeamRowId,
    );
    // The team is still bound to project A (the B binding was removed above),
    // so the config's requirement reports as already satisfied.
    expect(teamItem).toMatchObject({ projectId: projectAId, alreadyBound: true });

    const robotPlan = await get("/api/credential-bindings/plan", {
      authorization: `Bearer ${robotBBearer}`,
    });
    expect(robotPlan.status).toBe(403);
  });
});
