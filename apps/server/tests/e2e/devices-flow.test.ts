import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { del, get, parseCookies, patch, post, postRaw } = setupE2EWorker(
  ".wrangler/state/e2e-devices",
);

const UDID_A = "00008030-001c45663c90802e";
const UDID_B = "abcdef0123456789abcdef0123456789abcdef01";
const UDID_MAC = "abcdef01-2345-6789-abcd-ef0123456789";

describe("Devices API flow", () => {
  let cookies: string;
  let organizationId: string;
  let deviceId: string;

  it("registers a user + organization", async () => {
    const signup = await post("/api/auth/sign-up/email", {
      name: "Device E2E User",
      email: "device-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(signup.status).toBe(200);
    cookies = parseCookies(signup);

    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Device Org", slug: "device-org" },
      { cookie: cookies },
    );
    expect(orgRes.status).toBe(200);
    organizationId = (await orgRes.json()).id;
    cookies = parseCookies(orgRes) || cookies;

    const activeRes = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    expect(activeRes.status).toBe(200);
    cookies = parseCookies(activeRes) || cookies;
  });

  it("registers an iPhone device", async () => {
    const response = await post(
      "/api/devices",
      {
        identifier: UDID_A,
        name: "Alex's iPhone",
        deviceClass: "IPHONE",
        model: "iPhone 15 Pro",
      },
      { cookie: cookies },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.identifier).toBe(UDID_A);
    expect(body.deviceClass).toBe("IPHONE");
    expect(body.enabled).toBe(true);
    expect(body.name).toBe("Alex's iPhone");
    expect(body.model).toBe("iPhone 15 Pro");
    expect(body.organizationId).toBe(organizationId);
    deviceId = body.id;
  });

  it("rejects duplicate identifier in same org (409)", async () => {
    const response = await post(
      "/api/devices",
      { identifier: UDID_A, name: "Duplicate", deviceClass: "IPHONE" },
      { cookie: cookies },
    );
    expect(response.status).toBe(409);
  });

  it("rejects invalid UDID format (400)", async () => {
    const response = await post(
      "/api/devices",
      { identifier: "not-a-udid", name: "Bad", deviceClass: "IPHONE" },
      { cookie: cookies },
    );
    expect(response.status).toBe(400);
  });

  it("lists devices in the org", async () => {
    const response = await get("/api/devices", { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.items[0].identifier).toBe(UDID_A);
  });

  it("gets device by id", async () => {
    const response = await get(`/api/devices/${deviceId}`, { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(deviceId);
    expect(body.identifier).toBe(UDID_A);
  });

  it("renames a device", async () => {
    const response = await patch(
      `/api/devices/${deviceId}`,
      { name: "Renamed iPhone" },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("Renamed iPhone");
    expect(body.enabled).toBe(true);
  });

  it("disables a device", async () => {
    const response = await patch(
      `/api/devices/${deviceId}`,
      { enabled: false },
      { cookie: cookies },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.enabled).toBe(false);
    expect(body.name).toBe("Renamed iPhone");
  });

  it("registers a second device and filters by class", async () => {
    const macRes = await post(
      "/api/devices",
      { identifier: UDID_MAC, name: "Team Mac", deviceClass: "MAC" },
      { cookie: cookies },
    );
    expect(macRes.status).toBe(201);

    const ipadRes = await post(
      "/api/devices",
      { identifier: UDID_B, name: "QA iPad", deviceClass: "IPAD" },
      { cookie: cookies },
    );
    expect(ipadRes.status).toBe(201);

    const onlyMac = await get("/api/devices?deviceClass=MAC", { cookie: cookies });
    expect(onlyMac.status).toBe(200);
    const macBody = await onlyMac.json();
    expect(macBody.items).toHaveLength(1);
    expect(macBody.items[0].deviceClass).toBe("MAC");
    expect(macBody.total).toBe(1);

    const onlyIpad = await get("/api/devices?deviceClass=IPAD", { cookie: cookies });
    expect(onlyIpad.status).toBe(200);
    const ipadBody = await onlyIpad.json();
    expect(ipadBody.items).toHaveLength(1);
    expect(ipadBody.items[0].deviceClass).toBe("IPAD");
  });

  it("paginates devices via page+limit with stable order", async () => {
    const firstRes = await get("/api/devices?limit=2&page=1", { cookie: cookies });
    expect(firstRes.status).toBe(200);
    const firstBody = await firstRes.json();
    expect(firstBody.items.length).toBeLessThanOrEqual(2);
    expect(firstBody.page).toBe(1);
    if (firstBody.total > firstBody.items.length) {
      const secondRes = await get("/api/devices?limit=2&page=2", { cookie: cookies });
      expect(secondRes.status).toBe(200);
      const secondBody = await secondRes.json();
      expect(secondBody.page).toBe(2);
      const firstIds = new Set(firstBody.items.map((d: { id: string }) => d.id));
      secondBody.items.forEach((d: { id: string }) => {
        expect(firstIds.has(d.id)).toBe(false);
      });
    }
  });

  it("cross-org: devices from other org are not visible", async () => {
    const orgBRes = await post(
      "/api/auth/organization/create",
      { name: "Org B", slug: "device-org-b" },
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

    const listRes = await get("/api/devices", { cookie: cookies });
    expect(listRes.status).toBe(200);
    const body = await listRes.json();
    expect(body.items).toHaveLength(0);

    const getRes = await get(`/api/devices/${deviceId}`, { cookie: cookies });
    expect(getRes.status).toBe(404);

    const renameRes = await patch(
      `/api/devices/${deviceId}`,
      { name: "Hijacked" },
      { cookie: cookies },
    );
    expect(renameRes.status).toBe(404);

    // switch back
    const backRes = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    expect(backRes.status).toBe(200);
    cookies = parseCookies(backRes) || cookies;
  });

  it("deletes a device", async () => {
    const response = await del(`/api/devices/${deviceId}`, { cookie: cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deleted).toBe(1);

    const getRes = await get(`/api/devices/${deviceId}`, { cookie: cookies });
    expect(getRes.status).toBe(404);
  });

  describe("Registration request flow", () => {
    let inviteId: string;
    let inviteUrl: string;

    const callbackUdid = "ffeeddccbbaa99887766554433221100aabbccdd";

    it("creates an invite and returns URL + pending listing", async () => {
      const createRes = await post(
        "/api/devices/registration-requests",
        { deviceNameHint: "Tester iPhone", deviceClassHint: "IPHONE", ttlHours: 24 },
        { cookie: cookies },
      );
      expect(createRes.status).toBe(201);
      const invite = await createRes.json();
      expect(invite.url).toContain("/register-device/");
      expect(invite.deviceNameHint).toBe("Tester iPhone");
      expect(invite.consumedAt).toBeNull();
      inviteId = invite.id;
      inviteUrl = invite.url;

      const listRes = await get("/api/devices/registration-requests?active=true", {
        cookie: cookies,
      });
      expect(listRes.status).toBe(200);
      const listed = await listRes.json();
      expect(listed.items).toHaveLength(1);
      expect(listed.items[0].id).toBe(inviteId);
    });

    it("serves landing HTML without authentication", async () => {
      const landingPath = new URL(inviteUrl).pathname;
      const res = await get(landingPath);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain("Install profile");
    });

    it("serves .mobileconfig without authentication", async () => {
      const res = await get(`/register-device/${inviteId}/profile.mobileconfig`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/x-apple-aspen-config");
      const body = await res.text();
      expect(body).toContain("<string>Profile Service</string>");
      expect(body).toContain(`<string>${inviteId}</string>`);
    });

    it("registers a device via callback POST and marks invite consumed", async () => {
      const callbackBody = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>UDID</key><string>${callbackUdid}</string>
<key>PRODUCT</key><string>iPhone14,2</string>
<key>VERSION</key><string>17.2</string>
<key>DEVICE_NAME</key><string>Tester's iPhone</string>
<key>CHALLENGE</key><string>${inviteId}</string>
</dict></plist>`;

      const res = await postRaw(`/register-device/${inviteId}/callback`, callbackBody, {
        "content-type": "application/x-apple-aspen-config",
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("Device registered");

      const listRes = await get("/api/devices", { cookie: cookies });
      expect(listRes.status).toBe(200);
      const devices = (await listRes.json()).items as Array<{
        identifier: string;
        name: string;
      }>;
      const registered = devices.find((d) => d.identifier === callbackUdid);
      expect(registered).toBeDefined();
      expect(registered?.name).toBe("Tester's iPhone");

      const activeListRes = await get("/api/devices/registration-requests?active=true", {
        cookie: cookies,
      });
      const active = await activeListRes.json();
      expect(active.items.find((item: { id: string }) => item.id === inviteId)).toBeUndefined();
    });

    it("rejects callback on already-consumed invite (410)", async () => {
      const callbackBody = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>UDID</key><string>${callbackUdid}</string>
</dict></plist>`;

      const res = await postRaw(`/register-device/${inviteId}/callback`, callbackBody);
      expect(res.status).toBe(410);
    });

    it("returns 404 for unknown invite id", async () => {
      const res = await get("/register-device/00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(404);
    });
  });

  // ── Section 6: FTS substring search ─────────────────────────────
  // Note: by this point UDID_A "Renamed iPhone" has been deleted.
  // Remaining devices: UDID_MAC "Team Mac", UDID_B "QA iPad",
  // callbackUdid "Tester's iPhone".

  describe("FTS5 substring search", () => {
    it("matches by name substring (3+ chars)", async () => {
      const res = await get("/api/devices?query=Tester", { cookie: cookies });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      expect(body.items.some((d: { name: string }) => d.name.includes("Tester"))).toBe(true);
    });

    it("matches by identifier substring (3+ chars)", async () => {
      // UDID_B = "abcdef0123456789abcdef0123456789abcdef01" — search by prefix.
      const res = await get(`/api/devices?query=${UDID_B.slice(0, 8)}`, { cookie: cookies });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items.some((d: { identifier: string }) => d.identifier === UDID_B)).toBe(true);
    });

    it("falls back to LIKE for short query (<3 chars)", async () => {
      // "QA" → LIKE "%qa%" → matches "QA iPad" by name.
      const res = await get("/api/devices?query=QA", { cookie: cookies });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items.some((d: { name: string }) => d.name.includes("QA"))).toBe(true);
    });

    it("returns no items for non-matching substring", async () => {
      const res = await get("/api/devices?query=zzzz-no-such-device", { cookie: cookies });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toHaveLength(0);
      expect(body.total).toBe(0);
    });
  });
});
