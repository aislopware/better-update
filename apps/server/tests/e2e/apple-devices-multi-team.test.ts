import { credentialEnvelope } from "../helpers/credential-envelope";
import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { get, parseCookies, post } = setupE2EWorker(".wrangler/state/e2e-apple-devices-multi");

const TEAM_A = "TEAMAAAAAA";
const TEAM_B = "TEAMBBBBBB";

interface DeviceItem {
  readonly id: string;
  readonly identifier: string;
  readonly appleTeamId: string | null;
}

describe("Apple Devices multi-team flow", () => {
  let cookies: string;
  let teamA: string;
  let teamB: string;

  it("signs up + activates an org", async () => {
    const signup = await post("/api/auth/sign-up/email", {
      name: "Multi Team User",
      email: "multi-team-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(signup.status).toBe(200);
    cookies = parseCookies(signup);

    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Multi Team Org", slug: "multi-team-org" },
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

  it("uploads certs for two distinct Apple teams", async () => {
    const certA = await post(
      "/api/apple/distribution-certificates",
      {
        ...credentialEnvelope(),
        serialNumber: "SN-TEAM-A",
        appleTeamIdentifier: TEAM_A,
        appleTeamName: "Team Alpha",
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2028-01-01T00:00:00Z",
      },
      { cookie: cookies },
    );
    expect(certA.status).toBe(201);
    teamA = (await certA.json()).appleTeamId;

    const certB = await post(
      "/api/apple/distribution-certificates",
      {
        ...credentialEnvelope(),
        serialNumber: "SN-TEAM-B",
        appleTeamIdentifier: TEAM_B,
        appleTeamName: "Team Bravo",
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2028-01-01T00:00:00Z",
      },
      { cookie: cookies },
    );
    expect(certB.status).toBe(201);
    teamB = (await certB.json()).appleTeamId;

    expect(teamA).not.toBe(teamB);

    const teams = await (await get("/api/apple-teams", { cookie: cookies })).json();
    expect(teams.items).toHaveLength(2);
  });

  it("registers devices scoped to each team", async () => {
    const devA = await post(
      "/api/devices",
      {
        identifier: "00008030-001c45663c90802e",
        name: "Alpha iPhone",
        deviceClass: "IPHONE",
        appleTeamId: teamA,
      },
      { cookie: cookies },
    );
    expect(devA.status).toBe(201);

    const devB = await post(
      "/api/devices",
      {
        identifier: "abcdef0123456789abcdef0123456789abcdef01",
        name: "Bravo iPad",
        deviceClass: "IPAD",
        appleTeamId: teamB,
      },
      { cookie: cookies },
    );
    expect(devB.status).toBe(201);

    const devOrphan = await post(
      "/api/devices",
      {
        identifier: "abcdef01-2345-6789-abcd-ef0123456789",
        name: "Orphan Mac",
        deviceClass: "MAC",
      },
      { cookie: cookies },
    );
    expect(devOrphan.status).toBe(201);
  });

  it("lists all devices without a team filter", async () => {
    const res = await get("/api/devices", { cookie: cookies });
    expect(res.status).toBe(200);
    const items = (await res.json()).items as DeviceItem[];
    expect(items).toHaveLength(3);
  });

  it("filters devices by appleTeamId=A (excludes B + orphan)", async () => {
    const res = await get(`/api/devices?appleTeamId=${teamA}`, { cookie: cookies });
    expect(res.status).toBe(200);
    const items = (await res.json()).items as DeviceItem[];
    expect(items).toHaveLength(1);
    expect(items[0]?.appleTeamId).toBe(teamA);
    expect(items[0]?.identifier).toBe("00008030-001c45663c90802e");
  });

  it("filters devices by appleTeamId=B (excludes A + orphan)", async () => {
    const res = await get(`/api/devices?appleTeamId=${teamB}`, { cookie: cookies });
    expect(res.status).toBe(200);
    const items = (await res.json()).items as DeviceItem[];
    expect(items).toHaveLength(1);
    expect(items[0]?.appleTeamId).toBe(teamB);
  });

  it("reports device counts per team on /api/apple-teams", async () => {
    const res = await get("/api/apple-teams", { cookie: cookies });
    expect(res.status).toBe(200);
    const teams = (await res.json()).items as Array<{
      id: string;
      appleTeamId: string;
      deviceCount: number;
    }>;
    const alpha = teams.find((team) => team.id === teamA);
    const bravo = teams.find((team) => team.id === teamB);
    expect(alpha?.deviceCount).toBe(1);
    expect(bravo?.deviceCount).toBe(1);
  });
});
