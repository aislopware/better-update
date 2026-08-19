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
  let pushCertId: string;
  let payCertId: string;
  let passCertId: string;
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
    const { id: organizationId } = await orgRes.json();
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
    const teamsBeforeBody = await teamsBefore.json();
    expect(teamsBeforeBody.items).toHaveLength(0);

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
    // No certificateType sent — a CLI predating the field, and no
    // developerIdIdentifier either, so it reads as an iOS certificate.
    expect(body.certificateType).toBe("IOS_DISTRIBUTION");
    certId = body.id;

    const teamsAfter = await get("/api/apple-teams", { cookie: cookies });
    expect(teamsAfter.status).toBe(200);
    const { items: teams } = await teamsAfter.json<{ items: AppleTeam[] }>();
    expect(teams).toHaveLength(1);
    const [team] = teams;
    expect(team?.appleTeamId).toBe(TEAM_A);
    expect(team?.distributionCertificateCount).toBe(1);
    expect(team?.pushKeyCount).toBe(0);
  });

  // Both certificates are deleted again on the way out: the tests below count
  // the team's certificates, and a macOS one left behind would make those
  // counts about this test rather than about theirs.
  it.each([
    ["an explicit certificateType", "DEVID0000001", "DEVELOPER_ID_APPLICATION"],
    // The pre-0101 compatibility path: an older CLI sends no certificateType
    // but does send the UID, which is the signal the type replaced.
    ["a developerIdIdentifier alone", "DEVID0000002", undefined],
  ])("stores a macOS Developer ID certificate from %s", async (_label, serial, certificateType) => {
    const res = await post(
      "/api/apple/distribution-certificates",
      {
        ...credentialEnvelope(),
        serialNumber: serial,
        ...(certificateType === undefined ? {} : { certificateType }),
        developerIdIdentifier: TEAM_A,
        appleTeamIdentifier: TEAM_A,
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2028-01-01T00:00:00Z",
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.certificateType).toBe("DEVELOPER_ID_APPLICATION");
    expect(body.developerIdIdentifier).toBe(TEAM_A);

    const deleted = await del(`/api/apple/distribution-certificates/${body.id}`, {
      cookie: cookies,
    });
    expect(deleted.status).toBe(200);
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

    const teamsResponse = await get("/api/apple-teams", { cookie: cookies });
    const { items: teams } = await teamsResponse.json<{ items: AppleTeam[] }>();
    expect(teams).toHaveLength(1);
    const [team] = teams;
    expect(team?.distributionCertificateCount).toBe(1);
    expect(team?.pushKeyCount).toBe(1);
  });

  it("uploads a push SSL certificate bound to the same apple team and downloads it", async () => {
    const res = await post(
      "/api/apple/push-certificates",
      {
        ...credentialEnvelope(),
        bundleIdentifier: "com.acme.app",
        serialNumber: "PUSHCERT0001",
        appleTeamIdentifier: TEAM_A,
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2027-01-01T00:00:00Z",
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.bundleIdentifier).toBe("com.acme.app");
    expect(body.serialNumber).toBe("PUSHCERT0001");
    pushCertId = body.id;

    const getResult = await get("/api/apple/push-certificates", { cookie: cookies });
    const listed = await getResult.json();
    expect(listed.items).toHaveLength(1);

    const download = await get(`/api/apple/push-certificates/${pushCertId}/download`, {
      cookie: cookies,
    });
    expect(download.status).toBe(200);
    const downloadBody = await download.json();
    expect(downloadBody.bundleIdentifier).toBe("com.acme.app");
    expect(downloadBody.serialNumber).toBe("PUSHCERT0001");
    expect(downloadBody.ciphertext).toMatch(/./u);
    expect(downloadBody.wrappedDek).toMatch(/./u);
  });

  it("uploads an Apple Pay certificate and downloads it", async () => {
    const res = await post(
      "/api/apple/pay-certificates",
      {
        ...credentialEnvelope(),
        merchantIdentifier: "merchant.com.acme.pay",
        serialNumber: "PAYCERT00001",
        appleTeamIdentifier: TEAM_A,
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2027-01-01T00:00:00Z",
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.merchantIdentifier).toBe("merchant.com.acme.pay");
    payCertId = body.id;

    const getResult2 = await get("/api/apple/pay-certificates", { cookie: cookies });
    const listed = await getResult2.json();
    expect(listed.items).toHaveLength(1);

    const download = await get(`/api/apple/pay-certificates/${payCertId}/download`, {
      cookie: cookies,
    });
    expect(download.status).toBe(200);
    const downloadBody = await download.json();
    expect(downloadBody.merchantIdentifier).toBe("merchant.com.acme.pay");
    expect(downloadBody.ciphertext).toMatch(/./u);
  });

  it("uploads a Pass Type ID certificate and downloads it", async () => {
    const res = await post(
      "/api/apple/pass-type-certificates",
      {
        ...credentialEnvelope(),
        passTypeIdentifier: "pass.com.acme.coupon",
        serialNumber: "PASSCERT0001",
        appleTeamIdentifier: TEAM_A,
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2027-01-01T00:00:00Z",
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.passTypeIdentifier).toBe("pass.com.acme.coupon");
    passCertId = body.id;

    const listedResponse = await get("/api/apple/pass-type-certificates", { cookie: cookies });
    const listed = await listedResponse.json();
    expect(listed.items).toHaveLength(1);

    const download = await get(`/api/apple/pass-type-certificates/${passCertId}/download`, {
      cookie: cookies,
    });
    expect(download.status).toBe(200);
    const downloadBody = await download.json();
    expect(downloadBody.passTypeIdentifier).toBe("pass.com.acme.coupon");
    expect(downloadBody.ciphertext).toMatch(/./u);
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
    expect(body.roles).toStrictEqual(["ADMIN"]);
    ascKeyId = body.id;

    const teamsResponse = await get("/api/apple-teams", { cookie: cookies });
    const { items: teams } = await teamsResponse.json<{ items: AppleTeam[] }>();
    expect(teams[0]?.ascApiKeyCount).toBe(1);
  });

  it("lists all apple credentials", async () => {
    const certsResponse = await get("/api/apple/distribution-certificates", { cookie: cookies });
    const certs = await certsResponse.json();
    expect(certs.items).toHaveLength(1);

    const getResult3 = await get("/api/apple/push-keys", { cookie: cookies });
    const pushKeys = await getResult3.json();
    expect(pushKeys.items).toHaveLength(1);

    const getResult4 = await get("/api/apple/asc-api-keys", { cookie: cookies });
    const ascKeys = await getResult4.json();
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

    const listedResponse = await get("/api/google/service-account-keys", { cookie: cookies });
    const listed = await listedResponse.json();
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

    const teamsResponse = await get("/api/apple-teams", { cookie: cookies });
    const { items: teams } = await teamsResponse.json<{ items: AppleTeam[] }>();
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
    const { id: orgBId } = await orgBRes.json();
    cookies = parseCookies(orgBRes) || cookies;

    const activeRes = await post(
      "/api/auth/organization/set-active",
      { organizationId: orgBId },
      { cookie: cookies },
    );
    expect(activeRes.status).toBe(200);
    cookies = parseCookies(activeRes) || cookies;

    const certsResponse = await get("/api/apple/distribution-certificates", { cookie: cookies });
    const certs = await certsResponse.json();
    expect(certs.items).toHaveLength(0);
    const getResult5 = await get("/api/apple-teams", { cookie: cookies });
    const teams = await getResult5.json();
    expect(teams.items).toHaveLength(0);

    // Getting org A's push key from org B → 404
    const probe = await del(`/api/apple/push-keys/${pushKeyId}`, { cookie: cookies });
    expect(probe.status).toBe(404);
    const probeAsc = await del(`/api/apple/asc-api-keys/${ascKeyId}`, { cookie: cookies });
    expect(probeAsc.status).toBe(404);
    const probePushCert = await del(`/api/apple/push-certificates/${pushCertId}`, {
      cookie: cookies,
    });
    expect(probePushCert.status).toBe(404);
    const probePayCert = await del(`/api/apple/pay-certificates/${payCertId}`, { cookie: cookies });
    expect(probePayCert.status).toBe(404);
    const probePassCert = await del(`/api/apple/pass-type-certificates/${passCertId}`, {
      cookie: cookies,
    });
    expect(probePassCert.status).toBe(404);
  });
});
