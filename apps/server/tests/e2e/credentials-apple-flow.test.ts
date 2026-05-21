import { credentialEnvelope } from "../helpers/credential-envelope";
import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { del, get, parseCookies, post } = setupE2EWorker(".wrangler/state/e2e-credentials-apple");

const TEAM_A = "ABCDE12345";

interface AppleTeam {
  readonly id: string;
  readonly appleTeamId: string;
  readonly distributionCertificateCount: number;
  readonly pushKeyCount: number;
  readonly ascApiKeyCount: number;
}

describe("Credentials Apple flow", () => {
  let cookies: string;
  let certId: string;
  let pushKeyId: string;
  let ascKeyId: string;

  it("signs up and activates an org", async () => {
    const signup = await post("/api/auth/sign-up/email", {
      name: "Apple Cred User",
      email: "apple-cred-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(signup.status).toBe(200);
    cookies = parseCookies(signup);

    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Apple Cred Org", slug: "apple-cred-org" },
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
  });

  it("uploads a distribution certificate and auto-creates the Apple team", async () => {
    const teamsBefore = await get("/api/apple-teams", { cookie: cookies });
    expect(teamsBefore.status).toBe(200);
    expect((await teamsBefore.json()).items).toHaveLength(0);

    const res = await post(
      "/api/apple/distribution-certificates",
      {
        ...credentialEnvelope(),
        serialNumber: "AB12CD34EF56",
        appleTeamIdentifier: TEAM_A,
        appleTeamName: "Acme Inc.",
        appleTeamType: "COMPANY_ORGANIZATION",
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2028-01-01T00:00:00Z",
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.serialNumber).toBe("AB12CD34EF56");
    certId = body.id;

    const teamsAfter = await get("/api/apple-teams", { cookie: cookies });
    expect(teamsAfter.status).toBe(200);
    const teams = (await teamsAfter.json()).items as AppleTeam[];
    expect(teams).toHaveLength(1);
    const [team] = teams;
    expect(team?.appleTeamId).toBe(TEAM_A);
    expect(team?.distributionCertificateCount).toBe(1);
    expect(team?.pushKeyCount).toBe(0);
  });

  it("rejects an invalid apple team identifier", async () => {
    const res = await post(
      "/api/apple/distribution-certificates",
      {
        ...credentialEnvelope(),
        serialNumber: "SN1",
        appleTeamIdentifier: "not-valid",
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2028-01-01T00:00:00Z",
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(400);
  });

  it("uploads a push key bound to the same apple team", async () => {
    const res = await post(
      "/api/apple/push-keys",
      {
        ...credentialEnvelope(),
        keyId: "PUSH1234AB",
        appleTeamIdentifier: TEAM_A,
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.keyId).toBe("PUSH1234AB");
    pushKeyId = body.id;

    const teams = (await (await get("/api/apple-teams", { cookie: cookies })).json())
      .items as AppleTeam[];
    expect(teams).toHaveLength(1);
    const [team] = teams;
    expect(team?.distributionCertificateCount).toBe(1);
    expect(team?.pushKeyCount).toBe(1);
  });

  it("uploads an ASC API key bound to the same apple team", async () => {
    const res = await post(
      "/api/apple/asc-api-keys",
      {
        ...credentialEnvelope(),
        name: "CI Key",
        keyId: "ASCKEY1234",
        issuerId: "12345678-1234-1234-1234-123456789012",
        appleTeamIdentifier: TEAM_A,
        roles: ["ADMIN"],
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.keyId).toBe("ASCKEY1234");
    expect(body.roles).toEqual(["ADMIN"]);
    ascKeyId = body.id;

    const teams = (await (await get("/api/apple-teams", { cookie: cookies })).json())
      .items as AppleTeam[];
    expect(teams[0]?.ascApiKeyCount).toBe(1);
  });

  it("lists all apple credentials", async () => {
    const certs = await (
      await get("/api/apple/distribution-certificates", { cookie: cookies })
    ).json();
    expect(certs.items).toHaveLength(1);

    const pushKeys = await (await get("/api/apple/push-keys", { cookie: cookies })).json();
    expect(pushKeys.items).toHaveLength(1);

    const ascKeys = await (await get("/api/apple/asc-api-keys", { cookie: cookies })).json();
    expect(ascKeys.items).toHaveLength(1);
  });

  it("uploads a Google service account key and lists it", async () => {
    const res = await post(
      "/api/google/service-account-keys",
      {
        ...credentialEnvelope(),
        clientEmail: "svc@my-gcp-project.iam.gserviceaccount.com",
        privateKeyId: "abc123def456",
        googleProjectId: "my-gcp-project",
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.clientEmail).toBe("svc@my-gcp-project.iam.gserviceaccount.com");
    expect(body.privateKeyId).toBe("abc123def456");
    expect(body.googleProjectId).toBe("my-gcp-project");

    const listed = await (
      await get("/api/google/service-account-keys", { cookie: cookies })
    ).json();
    expect(listed.items).toHaveLength(1);
  });

  it("rejects a google service account key missing required metadata", async () => {
    const res = await post(
      "/api/google/service-account-keys",
      {
        ...credentialEnvelope(),
        clientEmail: "",
        privateKeyId: "abc123def456",
        googleProjectId: "my-gcp-project",
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(400);
  });

  it("deletes a cert but leaves the team alive (push + asc still attached)", async () => {
    const res = await del(`/api/apple/distribution-certificates/${certId}`, {
      cookie: cookies,
    });
    expect(res.status).toBe(200);

    const teams = (await (await get("/api/apple-teams", { cookie: cookies })).json())
      .items as AppleTeam[];
    expect(teams).toHaveLength(1);
    const [team] = teams;
    expect(team?.distributionCertificateCount).toBe(0);
    expect(team?.pushKeyCount).toBe(1);
    expect(team?.ascApiKeyCount).toBe(1);
  });

  it("allows ASC API key upload with no team (individual-scoped)", async () => {
    const res = await post(
      "/api/apple/asc-api-keys",
      {
        ...credentialEnvelope(),
        name: "Personal",
        keyId: "PERSONAL01",
        issuerId: "99999999-9999-9999-9999-999999999999",
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.appleTeamId).toBeNull();
  });

  it("cross-org isolation: credentials in org A invisible from org B", async () => {
    const orgBRes = await post(
      "/api/auth/organization/create",
      { name: "Other", slug: "apple-cred-org-b" },
      { cookie: cookies },
    );
    expect(orgBRes.status).toBe(200);
    const orgBId = (await orgBRes.json()).id;
    cookies = parseCookies(orgBRes) || cookies;

    const activeRes = await post(
      "/api/auth/organization/set-active",
      { organizationId: orgBId },
      { cookie: cookies },
    );
    expect(activeRes.status).toBe(200);
    cookies = parseCookies(activeRes) || cookies;

    const certs = await (
      await get("/api/apple/distribution-certificates", { cookie: cookies })
    ).json();
    expect(certs.items).toHaveLength(0);
    const teams = await (await get("/api/apple-teams", { cookie: cookies })).json();
    expect(teams.items).toHaveLength(0);

    // Getting org A's push key from org B → 404
    const probe = await del(`/api/apple/push-keys/${pushKeyId}`, { cookie: cookies });
    expect(probe.status).toBe(404);
    const probeAsc = await del(`/api/apple/asc-api-keys/${ascKeyId}`, { cookie: cookies });
    expect(probeAsc.status).toBe(404);
  });
});
