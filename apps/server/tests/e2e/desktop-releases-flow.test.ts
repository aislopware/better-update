import { createHash } from "node:crypto";

import { env } from "cloudflare:workers";

import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { del, get, parseCookies, patch, post } = setupE2EWorker(
  ".wrangler/state/e2e-desktop-releases",
);

/**
 * macOS Developer ID releases through the real Worker + D1: the release API
 * (create, re-release, halt, rollout, phasing, delete), the public Sparkle
 * appcast and electron-updater feeds it renders, server-side rollout bucketing
 * by `installId`, per-architecture files, electron-updater blockmaps and the
 * byte ranges its differential download asks for, and the download redirect the feeds
 * point at.
 */
describe("desktop releases + update feeds flow", () => {
  let cookies: string;
  let organizationId: string;
  let projectId: string;
  let dmgBuildId: string;
  let zipBuildId: string;
  let intelZipBuildId: string;
  let dmgReleaseId: string;
  let zipReleaseId: string;

  const artifactBytes = Buffer.from("e2e macos release");
  const artifactSha256 = createHash("sha256").update(artifactBytes).digest("hex");
  const sha512 = createHash("sha512").update(artifactBytes).digest("base64");
  const edSignature = Buffer.alloc(64, 7).toString("base64");

  /** The hash the feed buckets installs with: SHA-256(`<releaseId>:<installId>`). */
  const rolloutFraction = (releaseId: string, installId: string) =>
    createHash("sha256").update(`${releaseId}:${installId}`).digest().readUInt32BE(0) /
    4_294_967_296;

  const findInstall = (releaseId: string, inside: boolean, percentage: number) =>
    Array.from({ length: 200 }, (_, index) => `install-${String(index)}`).find(
      (installId) => rolloutFraction(releaseId, installId) < percentage / 100 === inside,
    ) ?? "";

  const completedBuild = async (body: Record<string, unknown>, bytes: Buffer = artifactBytes) => {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const reserved = await post(
      "/api/builds",
      {
        projectId,
        sha256,
        byteSize: bytes.byteLength,
        bundleId: "com.example.desktop",
        ...body,
      },
      { cookie: cookies },
    );
    expect(reserved.status).toBe(201);
    const { id } = await reserved.json<{ id: string }>();
    const complete = await post(
      `/api/builds/${id}/complete`,
      { sha256, byteSize: bytes.byteLength },
      { cookie: cookies },
    );
    expect(complete.status).toBe(200);
    return id;
  };

  const feed = async (path: string) => get(`/feeds/${projectId}/macos/${path}`);
  const feedStatus = async (path: string) => {
    const response = await feed(path);
    return response.status;
  };
  const feedText = async (path: string) => {
    const response = await feed(path);
    return response.text();
  };

  it("bootstraps a user, organization and project", async () => {
    const signUp = await post("/api/auth/sign-up/email", {
      name: "Desktop Release User",
      email: "desktop-release-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(signUp.status).toBe(200);
    cookies = parseCookies(signUp);

    const org = await post(
      "/api/auth/organization/create",
      { name: "Desktop Release Org", slug: "desktop-release-org" },
      { cookie: cookies },
    );
    expect(org.status).toBe(200);
    ({ id: organizationId } = await org.json<{ id: string }>());
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
      { name: "Desktop Release Project", slug: "desktop-release" },
      { cookie: cookies },
    );
    expect(project.status).toBe(201);
    ({ id: projectId } = await project.json<{ id: string }>());

    dmgBuildId = await completedBuild({
      platform: "macos",
      distribution: "developer-id",
      artifactFormat: "dmg",
      appVersion: "1.4.0",
      buildNumber: "140",
      metadata: {
        macos: {
          appName: "Example Desktop",
          minimumSystemVersion: "13.0",
          notarization: { status: "accepted", stapled: true },
        },
      },
    });
    zipBuildId = await completedBuild({
      platform: "macos",
      distribution: "developer-id",
      artifactFormat: "zip",
      appVersion: "1.5.0",
      buildNumber: "150",
      metadata: { macos: { appName: "Example Desktop", architectures: ["arm64"] } },
    });
    intelZipBuildId = await completedBuild({
      platform: "macos",
      distribution: "developer-id",
      artifactFormat: "zip",
      appVersion: "1.5.0",
      buildNumber: "151",
      metadata: { macos: { appName: "Example Desktop", architectures: ["x86_64"] } },
    });
  });

  it("refuses builds that are not finished macOS Developer ID builds", async () => {
    const iosBuildId = await completedBuild({
      platform: "ios",
      distribution: "ad-hoc",
      artifactFormat: "ipa",
    });
    const ios = await post(
      `/api/projects/${projectId}/desktop-releases`,
      { buildId: iosBuildId, channel: "latest", sha512 },
      { cookie: cookies },
    );
    expect(ios.status).toBe(400);

    const reserved = await post(
      "/api/builds",
      {
        projectId,
        platform: "macos",
        distribution: "developer-id",
        artifactFormat: "dmg",
        sha256: artifactSha256,
        byteSize: artifactBytes.byteLength,
      },
      { cookie: cookies },
    );
    const { id: pendingBuildId } = await reserved.json<{ id: string }>();
    const pending = await post(
      `/api/projects/${projectId}/desktop-releases`,
      { buildId: pendingBuildId, channel: "latest", sha512 },
      { cookie: cookies },
    );
    // Until it completes, a reserved build is not a build yet.
    expect(pending.status).toBe(404);

    const badChannel = await post(
      `/api/projects/${projectId}/desktop-releases`,
      { buildId: dmgBuildId, channel: "Not A Channel", sha512 },
      { cookie: cookies },
    );
    expect(badChannel.status).toBe(400);
  });

  it("releases a DMG to latest and a staged zip to beta", async () => {
    const dmg = await post(
      `/api/projects/${projectId}/desktop-releases`,
      {
        buildId: dmgBuildId,
        channel: "latest",
        sha512,
        sparkleEdSignature: edSignature,
        releaseNotes: "First <public> release",
      },
      { cookie: cookies },
    );
    expect(dmg.status).toBe(201);
    const dmgBody = await dmg.json();
    expect(dmgBody).toMatchObject({
      buildId: dmgBuildId,
      channel: "latest",
      appVersion: "1.4.0",
      buildNumber: "140",
      artifactFormat: "dmg",
      rolloutPercentage: 100,
      halted: false,
      critical: false,
      sparkleSigned: true,
    });
    dmgReleaseId = dmgBody.id;

    const zip = await post(
      `/api/projects/${projectId}/desktop-releases`,
      { buildId: zipBuildId, channel: "beta", sha512, rolloutPercentage: 30, critical: true },
      { cookie: cookies },
    );
    expect(zip.status).toBe(201);
    ({ id: zipReleaseId } = await zip.json<{ id: string }>());

    const list = await get(`/api/projects/${projectId}/desktop-releases`, { cookie: cookies });
    expect(list.status).toBe(200);
    const listBody = await list.json<{ items: { id: string }[]; total: number }>();
    expect(listBody.total).toBe(2);
    expect(listBody.items.map((item) => item.id)).toStrictEqual([zipReleaseId, dmgReleaseId]);

    const beta = await get(`/api/projects/${projectId}/desktop-releases?channel=beta`, {
      cookie: cookies,
    });
    const betaBody = await beta.json<{ items: { id: string }[] }>();
    expect(betaBody.items.map((item) => item.id)).toStrictEqual([zipReleaseId]);
  });

  it("re-releasing the same build to a channel replaces it in place", async () => {
    const again = await post(
      `/api/projects/${projectId}/desktop-releases`,
      {
        buildId: dmgBuildId,
        channel: "latest",
        sha512,
        sparkleEdSignature: edSignature,
        releaseNotes: "First <public> release",
      },
      { cookie: cookies },
    );
    expect(again.status).toBe(201);
    const { id: againId } = await again.json<{ id: string }>();
    expect(againId).toBe(dmgReleaseId);
  });

  it("serves a Sparkle appcast with server-side rollout bucketing", async () => {
    const bare = await feed("appcast.xml");
    expect(bare.status).toBe(200);
    expect(bare.headers.get("content-type")).toContain("application/rss+xml");
    expect(bare.headers.get("cache-control")).toBe("public, max-age=60");
    const xml = await bare.text();
    expect(xml).toContain("<sparkle:shortVersionString>1.4.0</sparkle:shortVersionString>");
    expect(xml).toContain("<sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion>");
    expect(xml).toContain(`sparkle:edSignature="${edSignature}"`);
    expect(xml).toContain(
      `url="http://localhost/feeds/${projectId}/macos/download/${dmgReleaseId}/Example-Desktop-1.4.0.dmg"`,
    );
    expect(xml).toContain(`length="${String(artifactBytes.byteLength)}"`);
    expect(xml).toContain("First &lt;public&gt; release");
    // A staged release is invisible without an install id to bucket.
    expect(xml).not.toContain("1.5.0");

    const insideInstall = findInstall(zipReleaseId, true, 30);
    const inside = await feed(`appcast.xml?installId=${insideInstall}`);
    expect(inside.headers.get("cache-control")).toBe("private, max-age=60");
    const insideXml = await inside.text();
    expect(insideXml).toContain("<sparkle:channel>beta</sparkle:channel>");
    expect(insideXml).toContain("<sparkle:criticalUpdate></sparkle:criticalUpdate>");
    expect(insideXml).toContain("<sparkle:shortVersionString>1.5.0</sparkle:shortVersionString>");
    // The beta zip is Apple-silicon-only: Intel Macs must skip it.
    expect(insideXml).toContain(
      "<sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>",
    );

    const outside = await feed(`appcast.xml?installId=${findInstall(zipReleaseId, false, 30)}`);
    await expect(outside.text()).resolves.not.toContain("1.5.0");
  });

  it("serves electron-updater channel files from zip releases only", async () => {
    const beta = await feed("beta-mac.yml");
    expect(beta.status).toBe(200);
    expect(beta.headers.get("content-type")).toContain("text/yaml");
    const yml = await beta.text();
    expect(yml).toContain('version: "1.5.0"');
    expect(yml).toContain(`path: "download/${zipReleaseId}/Example-Desktop-1.5.0-arm64.zip"`);
    expect(yml).toContain(`sha512: "${sha512}"`);
    expect(yml).toContain("stagingPercentage: 30");
    // Nothing for Intel Macs yet: electron-updater gives them non-arm64 files only.
    expect(yml).not.toContain("-x64.zip");

    // `latest` holds only a DMG, which Squirrel.Mac cannot install.
    await expect(feedStatus("latest-mac.yml")).resolves.toBe(404);
    await expect(feedStatus("unknown.txt")).resolves.toBe(404);
  });

  it("adds the same version's Intel zip as a second electron-updater file", async () => {
    const intel = await post(
      `/api/projects/${projectId}/desktop-releases`,
      { buildId: intelZipBuildId, channel: "beta", sha512 },
      { cookie: cookies },
    );
    expect(intel.status).toBe(201);
    const { id: intelReleaseId } = await intel.json<{ id: string }>();

    const yml = await feedText("beta-mac.yml");
    expect(yml).toContain(`  - url: "download/${intelReleaseId}/Example-Desktop-1.5.0-x64.zip"`);
    expect(yml).toContain(`  - url: "download/${zipReleaseId}/Example-Desktop-1.5.0-arm64.zip"`);
    // The newest release is the top-level file pre-`files` clients read.
    expect(yml).toContain(`path: "download/${intelReleaseId}/Example-Desktop-1.5.0-x64.zip"`);

    const deleted = await del(`/api/desktop-releases/${intelReleaseId}`, { cookie: cookies });
    expect(deleted.status).toBe(200);
  });

  it("redirects a feed download to a signed artifact URL", async () => {
    const download = await feed(`download/${dmgReleaseId}/Example-Desktop-1.4.0.dmg`);
    expect(download.status).toBe(302);
    expect(download.headers.get("cache-control")).toBe("no-store");
    const location = new URL(download.headers.get("location") ?? "");
    expect(location.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/u);
    expect(location.searchParams.get("response-content-disposition")).toBe(
      'attachment; filename="Example-Desktop-1.4.0.dmg"',
    );

    const otherProject = await get(
      `/feeds/00000000-0000-7000-8000-000000000000/macos/download/${dmgReleaseId}/x.dmg`,
    );
    expect(otherProject.status).toBe(404);

    const write = await post(`/feeds/${projectId}/macos/appcast.xml`, {});
    expect(write.status).toBe(405);
  });

  it("halts, widens and resumes a release", async () => {
    const halted = await patch(
      `/api/desktop-releases/${zipReleaseId}`,
      { halted: true },
      { cookie: cookies },
    );
    expect(halted.status).toBe(200);
    await expect(halted.json()).resolves.toMatchObject({ halted: true });
    await expect(feedStatus("beta-mac.yml")).resolves.toBe(404);
    await expect(feedStatus(`download/${zipReleaseId}/x.zip`)).resolves.toBe(404);

    const resumed = await patch(
      `/api/desktop-releases/${zipReleaseId}`,
      { halted: false, rolloutPercentage: 100, releaseNotes: null },
      { cookie: cookies },
    );
    await expect(resumed.json()).resolves.toMatchObject({
      halted: false,
      rolloutPercentage: 100,
      releaseNotes: null,
    });
    const yml = await feedText("beta-mac.yml");
    expect(yml).not.toContain("stagingPercentage");
    await expect(feedText("appcast.xml")).resolves.toContain("1.5.0");
  });

  it("turns Sparkle phasing on and off", async () => {
    const phased = await patch(
      `/api/desktop-releases/${zipReleaseId}`,
      { phasedRolloutHours: 24 },
      { cookie: cookies },
    );
    await expect(phased.json()).resolves.toMatchObject({ phasedRolloutHours: 24 });
    await expect(feedText("appcast.xml")).resolves.toContain(
      "<sparkle:phasedRolloutInterval>86400</sparkle:phasedRolloutInterval>",
    );

    const tooLong = await patch(
      `/api/desktop-releases/${zipReleaseId}`,
      { phasedRolloutHours: 721 },
      { cookie: cookies },
    );
    expect(tooLong.status).toBe(400);

    const cleared = await patch(
      `/api/desktop-releases/${zipReleaseId}`,
      { phasedRolloutHours: null },
      { cookie: cookies },
    );
    await expect(cleared.json()).resolves.toMatchObject({ phasedRolloutHours: null });
    await expect(feedText("appcast.xml")).resolves.not.toContain("phasedRolloutInterval");
  });

  it("serves signed .app.tar.gz releases to the Tauri updater", async () => {
    const tauriSignature = Buffer.from("untrusted comment: e2e\nsignature box").toString("base64");
    const refused = await post(
      `/api/projects/${projectId}/desktop-releases`,
      { buildId: dmgBuildId, channel: "latest", sha512, tauriSignature },
      { cookie: cookies },
    );
    expect(refused.status).toBe(400);
    await expect(feedStatus("latest-tauri.json")).resolves.toBe(204);

    const tarballBuildId = await completedBuild({
      platform: "macos",
      distribution: "developer-id",
      artifactFormat: "tar.gz",
      appVersion: "2.0.0",
      buildNumber: "200",
      metadata: { macos: { appName: "Example Desktop", architectures: ["arm64"] } },
    });
    const released = await post(
      `/api/projects/${projectId}/desktop-releases`,
      { buildId: tarballBuildId, channel: "latest", sha512, tauriSignature, rolloutPercentage: 50 },
      { cookie: cookies },
    );
    expect(released.status).toBe(201);
    const release = await released.json<{ id: string; tauriSigned: boolean }>();
    expect(release.tauriSigned).toBe(true);

    // Staged: a client without an install id is not offered it.
    await expect(feedStatus("latest-tauri.json")).resolves.toBe(204);
    const inside = findInstall(release.id, true, 50);
    const staticFeed = await get(`/feeds/${projectId}/macos/latest-tauri.json`, {
      "x-install-id": inside,
    });
    expect(staticFeed.status).toBe(200);
    expect(staticFeed.headers.get("cache-control")).toBe("private, max-age=60");
    const downloadUrl = `http://localhost/feeds/${projectId}/macos/download/${release.id}/Example-Desktop-2.0.0-arm64.app.tar.gz`;
    await expect(staticFeed.json()).resolves.toMatchObject({
      version: "2.0.0",
      platforms: { "darwin-aarch64": { url: downloadUrl, signature: tauriSignature } },
    });

    const dynamic = await feed(`latest-tauri.json?arch=aarch64&installId=${inside}`);
    await expect(dynamic.json()).resolves.toMatchObject({
      version: "2.0.0",
      url: downloadUrl,
      signature: tauriSignature,
    });
    // Apple-silicon-only: an Intel Mac has no update.
    await expect(feedStatus(`latest-tauri.json?arch=x86_64&installId=${inside}`)).resolves.toBe(
      204,
    );
    await expect(feedStatus("latest-tauri.json?arch=riscv64")).resolves.toBe(400);
    await expect(feedText(`appcast.xml?installId=${inside}`)).resolves.toContain(
      "Example-Desktop-2.0.0-arm64.app.tar.gz",
    );

    const deleted = await del(`/api/desktop-releases/${release.id}`, { cookie: cookies });
    expect(deleted.status).toBe(200);
  });

  it("serves blockmaps and byte ranges for electron-updater's differential download", async () => {
    // Deterministic bytes: version 3.1.0 shares its first half with 3.0.0.
    const block = (seed: number, length: number) =>
      Buffer.from(Array.from({ length }, (_, index) => (index * 31 + seed) % 251));
    const v1 = Buffer.concat([block(1, 4096), block(2, 4096)]);
    const v2 = Buffer.concat([block(1, 4096), block(3, 5000)]);
    const zipBuild = async (version: string, bytes: Buffer) => {
      const id = await completedBuild(
        {
          platform: "macos",
          distribution: "developer-id",
          artifactFormat: "zip",
          appVersion: version,
          metadata: { macos: { appName: "Example Desktop", architectures: ["arm64"] } },
        },
        bytes,
      );
      await env.BUILD_BUCKET.put(`builds/${organizationId}/${projectId}/${id}.zip`, bytes);
      return id;
    };
    const releaseZip = async (buildId: string, bytes: Buffer, blockmap: unknown) =>
      post(
        `/api/projects/${projectId}/desktop-releases`,
        {
          buildId,
          channel: "diff",
          sha512: createHash("sha512").update(bytes).digest("base64"),
          electronBlockmap: blockmap,
        },
        { cookie: cookies },
      );
    const v1BuildId = await zipBuild("3.0.0", v1);
    const v2BuildId = await zipBuild("3.1.0", v2);

    // A blockmap must describe exactly the artifact, and only a zip carries one.
    const short = await releaseZip(v1BuildId, v1, { checksums: ["AAAA"], sizes: [100] });
    expect(short.status).toBe(400);
    const onDmg = await post(
      `/api/projects/${projectId}/desktop-releases`,
      {
        buildId: dmgBuildId,
        channel: "diff",
        sha512,
        electronBlockmap: { checksums: [], sizes: [] },
      },
      { cookie: cookies },
    );
    expect(onDmg.status).toBe(400);

    const v1Release = await releaseZip(v1BuildId, v1, {
      checksums: ["AAAA", "BBBB"],
      sizes: [4096, 4096],
    });
    expect(v1Release.status).toBe(201);
    const v1Body = await v1Release.json();
    expect(v1Body).toMatchObject({ blockmap: true });
    const v2Release = await releaseZip(v2BuildId, v2, {
      checksums: ["AAAA", "CCCC"],
      sizes: [4096, 5000],
    });
    const v2Body = await v2Release.json();
    expect(v2Body).toMatchObject({ blockmap: true });
    const v2File = `download/${String(v2Body.id)}/Example-Desktop-3.1.0-arm64.zip`;

    const blockmapOf = async (path: string) => {
      const response = await feed(path);
      expect(response.status).toBe(200);
      const gunzipped = new Response(
        response.body?.pipeThrough(new DecompressionStream("gzip")) ?? null,
      );
      return gunzipped.json();
    };
    await expect(blockmapOf(`${v2File}.blockmap`)).resolves.toStrictEqual({
      version: "2",
      files: [{ name: "file", offset: 0, checksums: ["AAAA", "CCCC"], sizes: [4096, 5000] }],
    });
    // The updater's guess for the version it runs: the new URL with the old version.
    await expect(
      blockmapOf(`download/${String(v2Body.id)}/Example-Desktop-3.0.0-arm64.zip.blockmap`),
    ).resolves.toMatchObject({ files: [{ checksums: ["AAAA", "BBBB"] }] });
    await expect(
      feedStatus(`download/${String(v2Body.id)}/Example-Desktop-2.9.0-arm64.zip.blockmap`),
    ).resolves.toBe(404);
    await expect(
      feedStatus(`download/${dmgReleaseId}/Example-Desktop-1.4.0.dmg.blockmap`),
    ).resolves.toBe(404);

    // One range comes straight from R2.
    const single = await get(`/feeds/${projectId}/macos/${v2File}`, { range: "bytes=4096-4105" });
    expect(single.status).toBe(206);
    expect(single.headers.get("content-range")).toBe(`bytes 4096-4105/${String(v2.length)}`);
    expect(Buffer.from(await single.arrayBuffer()).equals(v2.subarray(4096, 4106))).toBe(true);

    // Several come back as multipart/byteranges, each part exactly its range.
    const ranges = [
      [0, 99],
      [4096, 4999],
      [9000, 9095],
    ] as const;
    const multi = await get(`/feeds/${projectId}/macos/${v2File}`, {
      range: `bytes=${ranges.map(([first, last]) => `${String(first)}-${String(last)}`).join(", ")}`,
    });
    expect(multi.status).toBe(206);
    const boundary = /boundary=(?<boundary>\S+)$/u.exec(multi.headers.get("content-type") ?? "")
      ?.groups?.["boundary"];
    expect(multi.headers.get("content-type")).toMatch(/^multipart\/byteranges; boundary=/u);
    const body = Buffer.from(await multi.arrayBuffer()).toString("latin1");
    const parts = body
      .split(`--${boundary ?? ""}`)
      .slice(1, -1)
      .map((part) => {
        const [headers = "", data = ""] = part.split("\r\n\r\n");
        return { headers, data: data.replace(/\r\n$/u, "") };
      });
    expect(
      parts.map((part) => /Content-Range: (?<range>.+)/u.exec(part.headers)?.groups?.["range"]),
    ).toStrictEqual(
      ranges.map(([first, last]) => `bytes ${String(first)}-${String(last)}/${String(v2.length)}`),
    );
    expect(parts.map((part) => part.data)).toStrictEqual(
      ranges.map(([first, last]) => v2.subarray(first, last + 1).toString("latin1")),
    );
    expect(body.endsWith(`--${boundary ?? ""}--\r\n`)).toBe(true);

    const outside = await get(`/feeds/${projectId}/macos/${v2File}`, { range: "bytes=99999-" });
    expect(outside.status).toBe(416);
    expect(outside.headers.get("content-range")).toBe(`bytes */${String(v2.length)}`);
    // Unordered ranges are not worth serving: the whole file, as without a Range.
    const unordered = await get(`/feeds/${projectId}/macos/${v2File}`, {
      range: "bytes=10-19, 0-9",
    });
    expect(unordered.status).toBe(302);

    // Deleting a build removes its blockmap with its artifact.
    const v1Key = `builds/${organizationId}/${projectId}/${v1BuildId}.zip`;
    await expect(env.BUILD_BUCKET.head(`${v1Key}.blockmap`)).resolves.not.toBeNull();
    const deleted = await del(`/api/builds/${v1BuildId}`, { cookie: cookies });
    expect(deleted.status).toBe(200);
    await expect(env.BUILD_BUCKET.head(`${v1Key}.blockmap`)).resolves.toBeNull();
    await expect(env.BUILD_BUCKET.head(v1Key)).resolves.toBeNull();
    const removed = await del(`/api/desktop-releases/${String(v2Body.id)}`, { cookie: cookies });
    expect(removed.status).toBe(200);
  });

  it("deletes a release, keeping the build", async () => {
    const deleted = await del(`/api/desktop-releases/${zipReleaseId}`, { cookie: cookies });
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toStrictEqual({ deleted: 1 });

    const release = await get(`/api/desktop-releases/${zipReleaseId}`, { cookie: cookies });
    expect(release.status).toBe(404);
    const build = await get(`/api/builds/${zipBuildId}`, { cookie: cookies });
    expect(build.status).toBe(200);
    await expect(feedText("appcast.xml")).resolves.not.toContain("1.5.0");
  });

  it("records release actions in the audit log", async () => {
    const audit = await get("/api/audit-logs?resourceType=build", { cookie: cookies });
    expect(audit.status).toBe(200);
    const body = await audit.json<{ items: { action: string }[] }>();
    const actions = new Set(body.items.map((item) => item.action));
    expect(actions).toContain("build.release");
    expect(actions).toContain("build.release.update");
    expect(actions).toContain("build.release.delete");
  });
});
