import { createHash } from "node:crypto";

import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { get, parseCookies, post } = setupE2EWorker(".wrangler/state/e2e-builds-macos");

/**
 * macOS Developer ID builds through the real Worker + D1: the widened
 * platform/distribution/format CHECKs (migration 0105), direct-download install
 * links, platform filtering, and isolation from every OTA surface (a macOS
 * build never takes Expo updates, so it must not leak into the compatibility
 * matrix).
 */
describe("macOS builds API flow", () => {
  let cookies: string;
  let organizationId: string;
  let projectId: string;
  let dmgBuildId: string;

  const artifactBytes = Buffer.from("e2e macos dmg");
  const artifactSha256 = createHash("sha256").update(artifactBytes).digest("hex");

  const reserve = async (body: Record<string, unknown>) =>
    post(
      "/api/builds",
      {
        projectId,
        sha256: artifactSha256,
        byteSize: artifactBytes.byteLength,
        ...body,
      },
      { cookie: cookies },
    );

  it("bootstraps a user, organization and project", async () => {
    const signUp = await post("/api/auth/sign-up/email", {
      name: "macOS Build User",
      email: "build-macos-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(signUp.status).toBe(200);
    cookies = parseCookies(signUp);

    const org = await post(
      "/api/auth/organization/create",
      { name: "macOS Build Org", slug: "build-macos-org" },
      { cookie: cookies },
    );
    expect(org.status).toBe(200);
    const orgBody = await org.json<{ id: string }>();
    organizationId = orgBody.id;
    cookies = parseCookies(org) || cookies;

    const active = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    expect(active.status).toBe(200);
    cookies = parseCookies(active) || cookies;

    const project = await post(
      "/api/projects",
      { name: "macOS Build Project", slug: "build-macos" },
      { cookie: cookies },
    );
    expect(project.status).toBe(201);
    const projectBody = await project.json<{ id: string }>();
    projectId = projectBody.id;
  });

  it("reserves and completes a Developer ID DMG build", async () => {
    const reserved = await reserve({
      platform: "macos",
      distribution: "developer-id",
      artifactFormat: "dmg",
      appVersion: "1.4.0",
      buildNumber: "140",
      bundleId: "com.example.desktop",
      metadata: {
        macos: { minimumSystemVersion: "11.0", architectures: ["arm64", "x86_64"] },
      },
    });
    expect(reserved.status).toBe(201);
    const reservedBody = await reserved.json<{ id: string }>();
    dmgBuildId = reservedBody.id;

    const complete = await post(
      `/api/builds/${dmgBuildId}/complete`,
      { sha256: artifactSha256, byteSize: artifactBytes.byteLength },
      { cookie: cookies },
    );
    expect(complete.status).toBe(200);
    const build = await complete.json();
    expect(build).toMatchObject({
      platform: "macos",
      distribution: "developer-id",
      runtimeVersion: null,
      artifact: { format: "dmg", contentType: "application/x-apple-diskimage" },
      installArtifact: null,
    });
    expect(JSON.parse(build.metadataJson)).toStrictEqual({
      macos: { minimumSystemVersion: "11.0", architectures: ["arm64", "x86_64"] },
    });
  });

  it("accepts zip and pkg containers", async () => {
    const zip = await reserve({
      platform: "macos",
      distribution: "developer-id",
      artifactFormat: "zip",
      bundleId: "com.example.desktop",
    });
    expect(zip.status).toBe(201);
    const pkg = await reserve({
      platform: "macos",
      distribution: "developer-id",
      artifactFormat: "pkg",
      bundleId: "com.example.desktop",
    });
    expect(pkg.status).toBe(201);
  });

  it("rejects platform/distribution/format combinations that do not exist", async () => {
    const appStoreMac = await reserve({
      platform: "macos",
      distribution: "app-store",
      artifactFormat: "dmg",
    });
    expect(appStoreMac.status).toBe(400);
    const macIpa = await reserve({
      platform: "macos",
      distribution: "developer-id",
      artifactFormat: "ipa",
    });
    expect(macIpa.status).toBe(400);
    const iosDmg = await reserve({
      platform: "ios",
      distribution: "developer-id",
      artifactFormat: "dmg",
    });
    expect(iosDmg.status).toBe(400);
  });

  it("links a Mac straight to the signed container", async () => {
    const response = await get(`/api/builds/${dmgBuildId}/install-link`, { cookie: cookies });
    expect(response.status).toBe(200);
    const links = await response.json();
    expect(links.artifactUrl).toContain(`/api/builds/${dmgBuildId}/artifact?token=`);
    expect(links.installUrl).toBe(links.artifactUrl);
  });

  it("filters the build list by the macos platform and the internal audience", async () => {
    const macos = await get(`/api/builds?projectId=${projectId}&platform=macos`, {
      cookie: cookies,
    });
    expect(macos.status).toBe(200);
    const macosBody = await macos.json<{ items: { id: string; platform: string }[] }>();
    expect(macosBody.items.map((item) => item.id)).toContain(dmgBuildId);
    expect(macosBody.items.every((item) => item.platform === "macos")).toBe(true);

    const internal = await get(`/api/builds?projectId=${projectId}&audience=internal`, {
      cookie: cookies,
    });
    const internalBody = await internal.json<{ items: { id: string }[] }>();
    expect(internalBody.items.map((item) => item.id)).toContain(dmgBuildId);
  });

  it("keeps macOS builds out of the OTA compatibility matrix", async () => {
    // Even with a runtime version (an Expo config left in a desktop repo), a
    // macOS build has no OTA platform to be compatible with.
    const withRuntime = await reserve({
      platform: "macos",
      distribution: "developer-id",
      artifactFormat: "dmg",
      runtimeVersion: "1.0.0",
    });
    expect(withRuntime.status).toBe(201);
    const { id } = await withRuntime.json<{ id: string }>();
    const complete = await post(
      `/api/builds/${id}/complete`,
      { sha256: artifactSha256, byteSize: artifactBytes.byteLength },
      { cookie: cookies },
    );
    expect(complete.status).toBe(200);

    const matrix = await get(`/api/builds/compatibility-matrix?projectId=${projectId}`, {
      cookie: cookies,
    });
    expect(matrix.status).toBe(200);
    const body = await matrix.json<{ channelStatusByKey: Record<string, unknown> }>();
    expect(Object.keys(body.channelStatusByKey).some((key) => key.includes("macos"))).toBe(false);
  });
});
