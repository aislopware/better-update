import { credentialEnvelope } from "../helpers/credential-envelope";
import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { get, parseCookies, post } = setupE2EWorker(".wrangler/state/e2e-apple-devices-sync");

const TEAM_IDENTIFIER = "SYNCTEAM01";
const EXISTING_UDID = "00008030-001c45663c90802e";
const IMPORTED_UDID = "00008030-001122334455667a";

interface SyncResult {
  readonly created: number;
  readonly linked: number;
  readonly unchanged: number;
}

interface DeviceItem {
  readonly identifier: string;
  readonly appleTeamId: string | null;
  readonly appleDevicePortalId: string | null;
}

describe("Apple device sync (App Store Connect reconcile)", () => {
  let cookies: string;
  let teamId: string;

  it("signs up + activates an org", async () => {
    const signup = await post("/api/auth/sign-up/email", {
      name: "Sync User",
      email: "device-sync-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(signup.status).toBe(200);
    cookies = parseCookies(signup);

    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Sync Org", slug: "device-sync-org" },
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

  it("derives an Apple team from an uploaded cert + registers a local device", async () => {
    const cert = await post(
      "/api/apple/distribution-certificates",
      {
        ...credentialEnvelope(),
        serialNumber: "SN-SYNC",
        appleTeamIdentifier: TEAM_IDENTIFIER,
        appleTeamName: "Sync Team",
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2028-01-01T00:00:00Z",
      },
      { cookie: cookies },
    );
    expect(cert.status).toBe(201);
    teamId = (await cert.json()).appleTeamId;

    const device = await post(
      "/api/devices",
      {
        identifier: EXISTING_UDID,
        name: "Existing iPhone",
        deviceClass: "IPHONE",
        appleTeamId: teamId,
      },
      { cookie: cookies },
    );
    expect(device.status).toBe(201);
    expect((await device.json()).appleDevicePortalId).toBeNull();
  });

  it("links the existing device and imports the Apple-only device", async () => {
    const res = await post(
      "/api/devices/sync",
      {
        appleTeamId: teamId,
        devices: [
          {
            identifier: EXISTING_UDID,
            name: "Existing iPhone",
            deviceClass: "IPHONE",
            appleDevicePortalId: "APPLEDEVICE01",
          },
          {
            identifier: IMPORTED_UDID,
            name: "Imported iPhone",
            deviceClass: "IPHONE",
            appleDevicePortalId: "APPLEDEVICE02",
          },
        ],
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncResult;
    expect(body).toEqual({ created: 1, linked: 1, unchanged: 0 });
  });

  it("reflects the portal ids on the device list", async () => {
    const res = await get(`/api/devices?appleTeamId=${teamId}`, { cookie: cookies });
    expect(res.status).toBe(200);
    const items = (await res.json()).items as DeviceItem[];
    expect(items).toHaveLength(2);
    const existing = items.find((item) => item.identifier === EXISTING_UDID);
    const imported = items.find((item) => item.identifier === IMPORTED_UDID);
    expect(existing?.appleDevicePortalId).toBe("APPLEDEVICE01");
    expect(imported?.appleDevicePortalId).toBe("APPLEDEVICE02");
    expect(imported?.appleTeamId).toBe(teamId);
  });

  it("is idempotent — re-syncing the same snapshot changes nothing", async () => {
    const res = await post(
      "/api/devices/sync",
      {
        appleTeamId: teamId,
        devices: [
          {
            identifier: EXISTING_UDID,
            name: "Existing iPhone",
            deviceClass: "IPHONE",
            appleDevicePortalId: "APPLEDEVICE01",
          },
          {
            identifier: IMPORTED_UDID,
            name: "Imported iPhone",
            deviceClass: "IPHONE",
            appleDevicePortalId: "APPLEDEVICE02",
          },
        ],
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as SyncResult).toEqual({ created: 0, linked: 0, unchanged: 2 });
  });

  it("translates an Apple Team Identifier passed as appleTeamId to 404, not a FK 500", async () => {
    const res = await post(
      "/api/devices/sync",
      {
        appleTeamId: TEAM_IDENTIFIER,
        devices: [
          {
            identifier: EXISTING_UDID,
            name: "Existing iPhone",
            deviceClass: "IPHONE",
            appleDevicePortalId: "APPLEDEVICE01",
          },
        ],
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { message: string }).message).toContain("Apple team");
  });
});
