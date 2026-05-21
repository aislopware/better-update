import { toBase64 } from "@better-update/encoding";

import { credentialEnvelope } from "../helpers/credential-envelope";
import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { del, get, parseCookies, post, put } = setupE2EWorker(
  ".wrangler/state/e2e-ios-bundle-config",
);

const TEAM = "ABCDE12345";
const BUNDLE = "com.example.app";

const buildMobileprovision = (teamId: string, bundleId: string) => {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>TeamIdentifier</key><array><string>${teamId}</string></array>
<key>application-identifier</key><string>${teamId}.${bundleId}</string>
<key>Name</key><string>E2E Profile</string>
<key>UUID</key><string>11111111-2222-3333-4444-555555555555</string>
<key>ExpirationDate</key><date>2030-01-01T00:00:00Z</date>
</dict></plist>`;
  return toBase64(new TextEncoder().encode(plist));
};

describe("iOS Bundle Configuration flow", () => {
  let cookies: string;
  let projectId: string;
  let appleTeamId: string;
  let certId: string;
  let profileId: string;
  let pushKeyId: string;
  let ascKeyId: string;
  let bundleConfigId: string;

  it("signs up + creates project", async () => {
    const signup = await post("/api/auth/sign-up/email", {
      name: "Bundle Config User",
      email: "bundle-config-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(signup.status).toBe(200);
    cookies = parseCookies(signup);

    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Bundle Org", slug: "bundle-org" },
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

    const projRes = await post(
      "/api/projects",
      { name: "iOS Proj", slug: "ios-proj" },
      { cookie: cookies },
    );
    expect(projRes.status).toBe(201);
    projectId = (await projRes.json()).id;
  });

  it("uploads cert + provisioning profile + push + ASC", async () => {
    const certRes = await post(
      "/api/apple/distribution-certificates",
      {
        ...credentialEnvelope(),
        serialNumber: "SN-BUNDLE-1",
        appleTeamIdentifier: TEAM,
        appleTeamName: "Bundle Team",
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2028-01-01T00:00:00Z",
      },
      { cookie: cookies },
    );
    expect(certRes.status).toBe(201);
    const certBody = await certRes.json();
    certId = certBody.id;
    appleTeamId = certBody.appleTeamId;

    const profRes = await post(
      "/api/apple/provisioning-profiles",
      {
        profileBase64: buildMobileprovision(TEAM, BUNDLE),
        appleDistributionCertificateId: certId,
      },
      { cookie: cookies },
    );
    expect(profRes.status).toBe(201);
    const profBody = await profRes.json();
    expect(profBody.bundleIdentifier).toBe(BUNDLE);
    expect(profBody.distributionType).toBe("APP_STORE");
    profileId = profBody.id;

    const pushRes = await post(
      "/api/apple/push-keys",
      { ...credentialEnvelope(), keyId: "BUNDLEPUSH", appleTeamIdentifier: TEAM },
      { cookie: cookies },
    );
    expect(pushRes.status).toBe(201);
    pushKeyId = (await pushRes.json()).id;

    const ascRes = await post(
      "/api/apple/asc-api-keys",
      {
        ...credentialEnvelope(),
        name: "Bundle ASC",
        keyId: "BUNDLEASC1",
        issuerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        appleTeamIdentifier: TEAM,
      },
      { cookie: cookies },
    );
    expect(ascRes.status).toBe(201);
    ascKeyId = (await ascRes.json()).id;
  });

  it("filters provisioning profiles by bundle + distributionType", async () => {
    const res = await get(
      `/api/apple/provisioning-profiles?bundleIdentifier=${BUNDLE}&distributionType=APP_STORE&appleTeamId=${appleTeamId}`,
      { cookie: cookies },
    );
    expect(res.status).toBe(200);
    const items = (await res.json()).items as Array<{ id: string }>;
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(profileId);
  });

  it("rejects a malformed mobileprovision", async () => {
    const res = await post(
      "/api/apple/provisioning-profiles",
      { profileBase64: toBase64(new TextEncoder().encode("not a plist")) },
      { cookie: cookies },
    );
    expect(res.status).toBe(400);
  });

  it("creates an iOS bundle configuration binding all four", async () => {
    const res = await post(
      `/api/projects/${projectId}/ios-bundle-configurations`,
      {
        bundleIdentifier: BUNDLE,
        distributionType: "APP_STORE",
        appleTeamId,
        appleDistributionCertificateId: certId,
        appleProvisioningProfileId: profileId,
        applePushKeyId: pushKeyId,
        ascApiKeyId: ascKeyId,
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.bundleIdentifier).toBe(BUNDLE);
    expect(body.distributionType).toBe("APP_STORE");
    expect(body.appleTeamId).toBe(appleTeamId);
    expect(body.appleDistributionCertificateId).toBe(certId);
    expect(body.appleProvisioningProfileId).toBe(profileId);
    expect(body.applePushKeyId).toBe(pushKeyId);
    expect(body.ascApiKeyId).toBe(ascKeyId);
    bundleConfigId = body.id;
  });

  it("lists bundle configurations for the project", async () => {
    const res = await get(`/api/projects/${projectId}/ios-bundle-configurations`, {
      cookie: cookies,
    });
    expect(res.status).toBe(200);
    const items = (await res.json()).items as Array<{ id: string }>;
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(bundleConfigId);
  });

  it("updates bindings on the bundle configuration", async () => {
    const res = await put(
      `/api/ios-bundle-configurations/${bundleConfigId}`,
      { applePushKeyId: null, ascApiKeyId: null },
      { cookie: cookies },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applePushKeyId).toBeNull();
    expect(body.ascApiKeyId).toBeNull();
    expect(body.appleDistributionCertificateId).toBe(certId);
  });

  it("creates an extension bundle configuration with targetName + parentBundleIdentifier", async () => {
    const extensionBundle = `${BUNDLE}.NotificationServiceExtension`;
    const createRes = await post(
      `/api/projects/${projectId}/ios-bundle-configurations`,
      {
        bundleIdentifier: extensionBundle,
        distributionType: "APP_STORE",
        appleTeamId,
        targetName: "NotificationServiceExtension",
        parentBundleIdentifier: BUNDLE,
      },
      { cookie: cookies },
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.targetName).toBe("NotificationServiceExtension");
    expect(created.parentBundleIdentifier).toBe(BUNDLE);

    const listRes = await get(`/api/projects/${projectId}/ios-bundle-configurations`, {
      cookie: cookies,
    });
    const items = (await listRes.json()).items as Array<{
      bundleIdentifier: string;
      targetName: string | null;
      parentBundleIdentifier: string | null;
    }>;
    const extensionRow = items.find((item) => item.bundleIdentifier === extensionBundle);
    expect(extensionRow?.targetName).toBe("NotificationServiceExtension");
    expect(extensionRow?.parentBundleIdentifier).toBe(BUNDLE);

    const updateRes = await put(
      `/api/ios-bundle-configurations/${String(created.id)}`,
      { targetName: null, parentBundleIdentifier: null },
      { cookie: cookies },
    );
    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json();
    expect(updated.targetName).toBeNull();
    expect(updated.parentBundleIdentifier).toBeNull();
  });

  it("deletes the bundle configuration", async () => {
    const res = await del(`/api/ios-bundle-configurations/${bundleConfigId}`, {
      cookie: cookies,
    });
    expect(res.status).toBe(200);

    // The extension configuration created earlier in this flow stays put — assert
    // the deleted config specifically is gone, not that the collection is empty.
    const list = await get(`/api/projects/${projectId}/ios-bundle-configurations`, {
      cookie: cookies,
    });
    const items = (await list.json()).items as Array<{ id: string }>;
    expect(items.find((config) => config.id === bundleConfigId)).toBeUndefined();
  });
});
