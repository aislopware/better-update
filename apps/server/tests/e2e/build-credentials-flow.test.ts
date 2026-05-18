import { fromBase64, toBase64 } from "@better-update/encoding";

import { setupE2EWorker } from "../helpers/e2e-worker";

const { parseCookies, post } = setupE2EWorker(".wrangler/state/e2e-build-credentials");

const dummyP12 = toBase64(new Uint8Array([0x30, 0x82, 0x01, 0x00, ...Array(40).fill(0xab)]));

// Starts with PKCS12 magic bytes (0x30 0x82) so the keystore parser accepts it.
const dummyKeystoreBytes = new Uint8Array([
  0x30,
  0x82,
  ...new Uint8Array(254).map((_, i) => (i * 7 + 13) % 256),
]);
const dummyKeystoreBase64 = toBase64(dummyKeystoreBytes);

const TEAM = "ABCDE12345";
const IOS_BUNDLE = "com.example.buildcreds";
const ANDROID_PACKAGE = "com.example.buildcreds";

const buildMobileprovision = (teamId: string, bundleId: string) => {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>TeamIdentifier</key><array><string>${teamId}</string></array>
<key>application-identifier</key><string>${teamId}.${bundleId}</string>
<key>Name</key><string>Build Creds Profile</string>
<key>UUID</key><string>99999999-8888-7777-6666-555555555555</string>
<key>ExpirationDate</key><date>2030-01-01T00:00:00Z</date>
</dict></plist>`;
  return {
    base64: toBase64(new TextEncoder().encode(plist)),
    bytes: new TextEncoder().encode(plist),
  };
};

describe("Build credentials resolve flow", () => {
  let cookies: string;
  let projectId: string;
  let certId: string;
  let profileId: string;
  let ascKeyId: string;
  let appleTeamId: string;
  let androidAppId: string;
  let keystoreId: string;
  let originalProfileBase64: string;

  it("signs up + creates project", async () => {
    const signup = await post("/api/auth/sign-up/email", {
      name: "BC User",
      email: "build-creds-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(signup.status).toBe(200);
    cookies = parseCookies(signup);

    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "BC Org", slug: "bc-org" },
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
      { name: "BC Proj", slug: "bc-proj" },
      { cookie: cookies },
    );
    expect(projRes.status).toBe(201);
    projectId = (await projRes.json()).id;
  });

  it("seeds iOS credentials + bundle configuration", async () => {
    const certRes = await post(
      "/api/apple/distribution-certificates",
      {
        p12Base64: dummyP12,
        p12Password: "super-secret",
        serialNumber: "SN-BC-1",
        appleTeamIdentifier: TEAM,
        appleTeamName: "BC Team",
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2028-01-01T00:00:00Z",
      },
      { cookie: cookies },
    );
    expect(certRes.status).toBe(201);
    const certBody = await certRes.json();
    certId = certBody.id;
    appleTeamId = certBody.appleTeamId;

    const profile = buildMobileprovision(TEAM, IOS_BUNDLE);
    originalProfileBase64 = profile.base64;
    const profRes = await post(
      "/api/apple/provisioning-profiles",
      { profileBase64: profile.base64, appleDistributionCertificateId: certId },
      { cookie: cookies },
    );
    expect(profRes.status).toBe(201);
    profileId = (await profRes.json()).id;

    const ascRes = await post(
      "/api/apple/asc-api-keys",
      {
        name: "BC ASC",
        keyId: "BCASC12345",
        issuerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        p8Pem: `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC
-----END PRIVATE KEY-----`,
        appleTeamIdentifier: TEAM,
      },
      { cookie: cookies },
    );
    expect(ascRes.status).toBe(201);
    ascKeyId = (await ascRes.json()).id;

    const bundleCfg = await post(
      `/api/projects/${projectId}/ios-bundle-configurations`,
      {
        bundleIdentifier: IOS_BUNDLE,
        distributionType: "APP_STORE",
        appleTeamId,
        appleDistributionCertificateId: certId,
        appleProvisioningProfileId: profileId,
        ascApiKeyId: ascKeyId,
      },
      { cookie: cookies },
    );
    expect(bundleCfg.status).toBe(201);
  });

  it("resolves iOS build credentials for APP_STORE", async () => {
    const res = await post(
      `/api/projects/${projectId}/build-credentials/resolve`,
      { platform: "ios", bundleIdentifier: IOS_BUNDLE, distributionType: "APP_STORE" },
      { cookie: cookies },
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.platform).toBe("ios");
    expect(body.distributionCertificate.p12Password).toBe("super-secret");
    expect(body.distributionCertificate.p12Base64).toBe(dummyP12);
    expect(body.provisioningProfile.mobileprovisionBase64).toBe(originalProfileBase64);
    expect(body.provisioningProfile.teamId).toBe(TEAM);
    expect(body.provisioningProfile.bundleIdentifier).toBe(IOS_BUNDLE);
    expect(body.provisioningProfile.distributionType).toBe("APP_STORE");
    expect(body.provisioningProfile.uuid).toBe("99999999-8888-7777-6666-555555555555");
    expect(body.provisioningProfile.name).toBe("Build Creds Profile");
    // No push key bound on this bundle config.
    expect(body.pushKey).toBeNull();

    // Verify bytes round-trip intact.
    const p12 = fromBase64(body.distributionCertificate.p12Base64);
    expect(p12.at(0)).toBe(0x30);
    expect(p12.byteLength).toBeGreaterThanOrEqual(40);
  });

  it("sets Cache-Control: no-store on resolve responses", async () => {
    const res = await post(
      `/api/projects/${projectId}/build-credentials/resolve`,
      { platform: "ios", bundleIdentifier: IOS_BUNDLE, distributionType: "APP_STORE" },
      { cookie: cookies },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("returns 404 when no iOS bundle configuration matches", async () => {
    const res = await post(
      `/api/projects/${projectId}/build-credentials/resolve`,
      { platform: "ios", bundleIdentifier: "com.missing.app", distributionType: "APP_STORE" },
      { cookie: cookies },
    );
    expect(res.status).toBe(404);
  });

  it("falls back to org+team ASC key when bundle config has none bound", async () => {
    // Bundle config omits ascApiKeyId (e.g. Apple ID interactive flow created
    // the binding). Server must fall back to the org+team-scoped ASC key so
    // extension auto-provisioning still works without forcing the dashboard
    // binding step. Mirrors EAS's account-level ASC key resolution.
    const noAscBundle = "com.example.buildcreds.noasc";
    const profile = buildMobileprovision(TEAM, noAscBundle);
    const profRes = await post(
      "/api/apple/provisioning-profiles",
      { profileBase64: profile.base64, appleDistributionCertificateId: certId },
      { cookie: cookies },
    );
    expect(profRes.status).toBe(201);
    const noAscProfileId = (await profRes.json()).id;

    const bundleCfg = await post(
      `/api/projects/${projectId}/ios-bundle-configurations`,
      {
        bundleIdentifier: noAscBundle,
        distributionType: "APP_STORE",
        appleTeamId,
        appleDistributionCertificateId: certId,
        appleProvisioningProfileId: noAscProfileId,
        // ascApiKeyId omitted — server resolves it from the team-level pool.
      },
      { cookie: cookies },
    );
    expect(bundleCfg.status).toBe(201);

    const res = await post(
      `/api/projects/${projectId}/build-credentials/resolve`,
      { platform: "ios", bundleIdentifier: noAscBundle, distributionType: "APP_STORE" },
      { cookie: cookies },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.platform).toBe("ios");
    expect(body.provisioningProfile.bundleIdentifier).toBe(noAscBundle);
    expect(body.distributionCertificate.p12Password).toBe("super-secret");
    // Fallback: the seeded ASC key for TEAM is picked up.
    expect(body.context.ascApiKeyId).toBe(ascKeyId);
  });

  it("returns null ascApiKeyId when no org+team ASC key exists", async () => {
    // Different Apple team with cert + profile but no ASC key uploaded → the
    // fallback finds nothing and the resolver returns null. CLI then surfaces
    // the "no ASC API key available" error if extensions need provisioning.
    const otherTeam = "ZZZZZ99999";
    const otherBundle = "com.example.buildcreds.otherteam";

    const otherCertRes = await post(
      "/api/apple/distribution-certificates",
      {
        p12Base64: dummyP12,
        p12Password: "super-secret",
        serialNumber: "SN-BC-2",
        appleTeamIdentifier: otherTeam,
        appleTeamName: "Other Team",
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2028-01-01T00:00:00Z",
      },
      { cookie: cookies },
    );
    expect(otherCertRes.status).toBe(201);
    const otherCert = await otherCertRes.json();
    const otherCertId: string = otherCert.id;
    const otherAppleTeamId: string = otherCert.appleTeamId;

    const profile = buildMobileprovision(otherTeam, otherBundle);
    const profRes = await post(
      "/api/apple/provisioning-profiles",
      { profileBase64: profile.base64, appleDistributionCertificateId: otherCertId },
      { cookie: cookies },
    );
    expect(profRes.status).toBe(201);
    const otherProfileId = (await profRes.json()).id;

    const bundleCfg = await post(
      `/api/projects/${projectId}/ios-bundle-configurations`,
      {
        bundleIdentifier: otherBundle,
        distributionType: "APP_STORE",
        appleTeamId: otherAppleTeamId,
        appleDistributionCertificateId: otherCertId,
        appleProvisioningProfileId: otherProfileId,
      },
      { cookie: cookies },
    );
    expect(bundleCfg.status).toBe(201);

    const res = await post(
      `/api/projects/${projectId}/build-credentials/resolve`,
      { platform: "ios", bundleIdentifier: otherBundle, distributionType: "APP_STORE" },
      { cookie: cookies },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.platform).toBe("ios");
    expect(body.context.ascApiKeyId).toBeNull();
  });

  it("seeds Android application identifier + keystore + build credentials", async () => {
    const appRes = await post(
      `/api/projects/${projectId}/android-application-identifiers`,
      { packageName: ANDROID_PACKAGE },
      { cookie: cookies },
    );
    expect(appRes.status).toBe(201);
    androidAppId = (await appRes.json()).id;

    const ksRes = await post(
      "/api/android/upload-keystores",
      {
        keystoreBase64: dummyKeystoreBase64,
        keyAlias: "release-alias",
        keystorePassword: "store-pw",
        keyPassword: "key-pw",
      },
      { cookie: cookies },
    );
    expect(ksRes.status).toBe(201);
    keystoreId = (await ksRes.json()).id;

    const bcRes = await post(
      `/api/android-application-identifiers/${androidAppId}/build-credentials`,
      {
        name: "Default",
        isDefault: true,
        androidUploadKeystoreId: keystoreId,
      },
      { cookie: cookies },
    );
    expect(bcRes.status).toBe(201);
  });

  it("resolves Android build credentials", async () => {
    const res = await post(
      `/api/projects/${projectId}/build-credentials/resolve`,
      { platform: "android", applicationIdentifier: ANDROID_PACKAGE },
      { cookie: cookies },
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.platform).toBe("android");
    expect(body.keystore.keyAlias).toBe("release-alias");
    expect(body.keystore.storePassword).toBe("store-pw");
    expect(body.keystore.keyPassword).toBe("key-pw");
    expect(body.keystore.keystoreBase64).toBe(dummyKeystoreBase64);
  });

  it("returns 404 for an unknown Android package", async () => {
    const res = await post(
      `/api/projects/${projectId}/build-credentials/resolve`,
      { platform: "android", applicationIdentifier: "com.missing.android" },
      { cookie: cookies },
    );
    expect(res.status).toBe(404);
  });

  it("rejects cross-project access", async () => {
    const otherOrgRes = await post(
      "/api/auth/organization/create",
      { name: "Other", slug: "bc-other" },
      { cookie: cookies },
    );
    expect(otherOrgRes.status).toBe(200);
    const otherOrgId = (await otherOrgRes.json()).id;
    cookies = parseCookies(otherOrgRes) || cookies;

    const activeRes = await post(
      "/api/auth/organization/set-active",
      { organizationId: otherOrgId },
      { cookie: cookies },
    );
    expect(activeRes.status).toBe(200);
    cookies = parseCookies(activeRes) || cookies;

    const res = await post(
      `/api/projects/${projectId}/build-credentials/resolve`,
      { platform: "ios", bundleIdentifier: IOS_BUNDLE, distributionType: "APP_STORE" },
      { cookie: cookies },
    );
    expect(res.status).toBe(404);
  });
});
