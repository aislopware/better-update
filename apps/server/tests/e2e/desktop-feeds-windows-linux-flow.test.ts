import { createHash } from "node:crypto";

import { env } from "cloudflare:workers";

import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { get, parseCookies, post } = setupE2EWorker(".wrangler/state/e2e-desktop-windows-linux");

/**
 * Windows and Linux desktop releases through the real Worker + D1: builds of
 * the new platforms and formats, the checks a release's signatures and
 * blockmaps get, and every feed they appear in — electron-updater's
 * `latest.yml` / `latest-linux[-arm64].yml`, WinSparkle's appcast, the Tauri
 * JSON per platform and across platforms — plus first-install links,
 * `releases.json`, an NSIS installer's differential-download blockmap, and
 * the macOS `minimumSystemVersion` electron-updater compares.
 */
describe("Windows + Linux desktop feeds flow", () => {
  let cookies: string;
  let organizationId: string;
  let projectId: string;
  const builds: Record<string, string> = {};
  const releases: Record<string, string> = {};

  const artifactBytes = Buffer.from("e2e desktop release");
  const sha512Of = (bytes: Buffer) => createHash("sha512").update(bytes).digest("base64");
  const edSignature = Buffer.alloc(64, 9).toString("base64");
  const tauriSignature = Buffer.from("untrusted comment: e2e\nRWQ=").toString("base64");

  const completedBuild = async (body: Record<string, unknown>, bytes: Buffer = artifactBytes) => {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const reserved = await post(
      "/api/builds",
      { projectId, sha256, byteSize: bytes.byteLength, bundleId: "com.example.desktop", ...body },
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

  const release = async (buildId: string, body: Record<string, unknown> = {}) =>
    post(
      `/api/projects/${projectId}/desktop-releases`,
      { buildId, channel: "latest", sha512: sha512Of(artifactBytes), ...body },
      { cookie: cookies },
    );

  const released = async (buildId: string, body: Record<string, unknown> = {}) => {
    const response = await release(buildId, body);
    expect(response.status).toBe(201);
    const { id } = await response.json<{ id: string }>();
    return id;
  };

  const feedText = async (path: string) => {
    const response = await get(`/feeds/${projectId}/${path}`);
    expect(response.status).toBe(200);
    return response.text();
  };

  const windows = async (fields: Record<string, unknown>, body: Record<string, unknown> = {}) =>
    completedBuild({
      platform: "windows",
      distribution: "direct",
      artifactFormat: "exe",
      appVersion: "2.0.0",
      ...body,
      metadata: { windows: { appName: "Example Desktop", ...fields } },
    });

  const linux = async (fields: Record<string, unknown>, body: Record<string, unknown> = {}) =>
    completedBuild({
      platform: "linux",
      distribution: "direct",
      artifactFormat: "appimage",
      appVersion: "2.0.0",
      ...body,
      metadata: {
        linux: { appName: "Example Desktop", packageName: "example-desktop", ...fields },
      },
    });

  it("bootstraps a user, organization and project", async () => {
    const signUp = await post("/api/auth/sign-up/email", {
      name: "Desktop Feeds User",
      email: "desktop-feeds-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(signUp.status).toBe(200);
    cookies = parseCookies(signUp);
    const org = await post(
      "/api/auth/organization/create",
      { name: "Desktop Feeds Org", slug: "desktop-feeds-org" },
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
    cookies = parseCookies(active) || cookies;
    const project = await post(
      "/api/projects",
      { name: "Desktop Feeds Project", slug: "desktop-feeds" },
      { cookie: cookies },
    );
    expect(project.status).toBe(201);
    ({ id: projectId } = await project.json<{ id: string }>());
  });

  it("stores Windows and Linux builds in their own formats only", async () => {
    builds["winX64"] = await windows(
      { architectures: ["x64"], minimumSystemVersion: "10.0.17763" },
      { buildNumber: "200" },
    );
    builds["winArm"] = await windows({ architectures: ["arm64"] }, { buildNumber: "200" });
    builds["winMsi"] = await windows({ architectures: ["x64"] }, { artifactFormat: "msi" });
    builds["linuxAppImage"] = await linux({ architectures: ["x64"], blockMapSize: 4321 });
    builds["linuxDeb"] = await linux({ architectures: ["x64"] }, { artifactFormat: "deb" });
    builds["linuxRpm"] = await linux({ architectures: ["x64"] }, { artifactFormat: "rpm" });
    builds["linuxArm"] = await linux({ architectures: ["arm64"] });

    const wrongFormat = await post(
      "/api/builds",
      {
        projectId,
        platform: "windows",
        distribution: "direct",
        artifactFormat: "dmg",
        sha256: "a".repeat(64),
        byteSize: 1,
        bundleId: "com.example.desktop",
      },
      { cookie: cookies },
    );
    expect(wrongFormat.status).toBe(400);

    const listed = await get(`/api/builds?projectId=${projectId}&platform=windows,linux`, {
      cookie: cookies,
    });
    expect(listed.status).toBe(200);
    const { items } = await listed.json<{ items: readonly { platform: string }[] }>();
    expect(items).toHaveLength(7);
  });

  it("only accepts the signatures and blockmaps a release's platform and format can carry", async () => {
    const sparkleOnWindows = await release(builds["winX64"] ?? "", {
      sparkleEdSignature: edSignature,
    });
    expect(sparkleOnWindows.status).toBe(400);
    const winSparkleOnLinux = await release(builds["linuxAppImage"] ?? "", {
      winSparkleEdSignature: edSignature,
    });
    expect(winSparkleOnLinux.status).toBe(400);
    const blockmapOnMsi = await release(builds["winMsi"] ?? "", {
      electronBlockmap: { checksums: ["AAAA"], sizes: [artifactBytes.byteLength] },
    });
    expect(blockmapOnMsi.status).toBe(400);
  });

  it("releases every build, recording platform, signatures and differential support", async () => {
    releases["winX64"] = await released(builds["winX64"] ?? "", {
      winSparkleEdSignature: edSignature,
      tauriSignature,
    });
    releases["winArm"] = await released(builds["winArm"] ?? "", { tauriSignature });
    releases["winMsi"] = await released(builds["winMsi"] ?? "", { tauriSignature });
    releases["linuxAppImage"] = await released(builds["linuxAppImage"] ?? "", { tauriSignature });
    releases["linuxDeb"] = await released(builds["linuxDeb"] ?? "", { tauriSignature });
    releases["linuxRpm"] = await released(builds["linuxRpm"] ?? "");
    releases["linuxArm"] = await released(builds["linuxArm"] ?? "", { rolloutPercentage: 30 });

    const listed = await get(`/api/projects/${projectId}/desktop-releases?platform=linux`, {
      cookie: cookies,
    });
    const { items } = await listed.json<{
      items: readonly { platform: string; blockmap: boolean; buildId: string }[];
    }>();
    expect(items).toHaveLength(4);
    expect(items.every((item) => item.platform === "linux")).toBe(true);
    // The AppImage carries its blockmap inside; the build recorded its size.
    expect(items.find((item) => item.buildId === builds["linuxAppImage"])?.blockmap).toBe(true);

    const win = await get(`/api/desktop-releases/${releases["winX64"] ?? ""}`, { cookie: cookies });
    await expect(win.json()).resolves.toMatchObject({
      platform: "windows",
      winSparkleSigned: true,
      tauriSigned: true,
      sparkleSigned: false,
    });
  });

  it("serves electron-updater's Windows latest.yml with one installer per architecture", async () => {
    const yml = await feedText("windows/latest.yml");
    expect(yml).toContain('version: "2.0.0"');
    expect(yml).toContain(
      `  - url: "download/${releases["winX64"] ?? ""}/Example-Desktop-Setup-2.0.0-x64.exe"`,
    );
    expect(yml).toContain(
      `  - url: "download/${releases["winArm"] ?? ""}/Example-Desktop-Setup-2.0.0-arm64.exe"`,
    );
    expect(yml).not.toContain(".msi");
    expect(yml).toContain('minimumSystemVersion: "10.0.17763"');
  });

  it("serves one Linux channel file per architecture, with every package type", async () => {
    const x64 = await feedText("linux/latest-linux.yml");
    expect(x64).toContain("Example-Desktop-2.0.0.AppImage");
    expect(x64).toContain("    blockMapSize: 4321");
    expect(x64).toContain("example-desktop_2.0.0_amd64.deb");
    expect(x64).toContain("example-desktop-2.0.0.x86_64.rpm");
    expect(x64).not.toContain("arm64");

    const arm = await feedText("linux/latest-linux-arm64.yml");
    expect(arm).toContain("Example-Desktop-2.0.0-arm64.AppImage");
    // electron-updater stages it client-side.
    expect(arm).toContain("stagingPercentage: 30");

    const missing = await get(`/feeds/${projectId}/linux/latest-linux-ia32.yml`);
    expect(missing.status).toBe(404);
  });

  it("serves a WinSparkle appcast per channel with an enclosure per architecture", async () => {
    const xml = await feedText("windows/appcast.xml");
    expect(xml.match(/<item>/gu)).toHaveLength(1);
    expect(xml).toContain(`sparkle:os="windows-x64" sparkle:edSignature="${edSignature}"`);
    expect(xml).toContain('sparkle:os="windows-arm64"/>');
    const beta = await feedText("windows/appcast.xml?channel=beta");
    expect(beta).not.toContain("<item>");
    const bad = await get(`/feeds/${projectId}/windows/appcast.xml?channel=Not%20A%20Channel`);
    expect(bad.status).toBe(400);
    // Linux has no appcast.
    const linuxAppcast = await get(`/feeds/${projectId}/linux/appcast.xml`);
    expect(linuxAppcast.status).toBe(404);
  });

  it("serves the Tauri JSON per platform and across platforms", async () => {
    const windowsStatic = JSON.parse(await feedText("windows/latest-tauri.json")) as {
      platforms: Record<string, { url: string }>;
    };
    expect(Object.keys(windowsStatic.platforms).toSorted()).toStrictEqual([
      "windows-aarch64",
      "windows-aarch64-nsis",
      "windows-x86_64",
      "windows-x86_64-msi",
      "windows-x86_64-nsis",
    ]);
    expect(windowsStatic.platforms["windows-x86_64"]?.url).toContain(
      `/feeds/${projectId}/windows/download/${releases["winX64"] ?? ""}/`,
    );

    const all = JSON.parse(await feedText("tauri/latest.json")) as {
      platforms: Record<string, unknown>;
    };
    expect(Object.keys(all.platforms)).toStrictEqual(
      expect.arrayContaining(["windows-x86_64-nsis", "linux-x86_64-appimage", "linux-x86_64-deb"]),
    );

    const debOnly = JSON.parse(
      await feedText("tauri/latest.json?target=linux&arch=x86_64&bundle_type=deb"),
    ) as { url: string };
    expect(debOnly.url).toContain("example-desktop_2.0.0_amd64.deb");

    // The rpm was released without a Tauri signature: an rpm-installed app gets no update.
    const rpm = await get(
      `/feeds/${projectId}/tauri/latest.json?target=linux&arch=x86_64&bundle_type=rpm`,
    );
    expect(rpm.status).toBe(204);
    const badTarget = await get(`/feeds/${projectId}/tauri/latest.json?target=beos&arch=x86_64`);
    expect(badTarget.status).toBe(400);
  });

  it("redirects first-install links to the newest fully rolled-out file", async () => {
    const latest = async (path: string) => get(`/feeds/${projectId}/${path}`);
    const exe = await latest("windows/latest/download");
    expect(exe.status).toBe(302);
    expect(exe.headers.get("location")).toContain("Example-Desktop-Setup-2.0.0-x64.exe");
    const arm = await latest("windows/latest/download?arch=aarch64");
    expect(arm.headers.get("location")).toContain("Example-Desktop-Setup-2.0.0-arm64.exe");
    const msi = await latest("windows/latest/download?format=msi");
    expect(msi.headers.get("location")).toContain(".msi");
    const deb = await latest("linux/latest/download?format=deb&arch=amd64");
    expect(deb.headers.get("location")).toContain("example-desktop_2.0.0_amd64.deb");
    // The arm64 AppImage is still rolling out: a first install does not get it.
    const armAppImage = await latest("linux/latest/download?arch=arm64");
    expect(armAppImage.status).toBe(404);
    const wrongFormat = await latest("linux/latest/download?format=dmg");
    expect(wrongFormat.status).toBe(400);
  });

  it("lists every platform's downloads in releases.json, readable cross-origin", async () => {
    const response = await get(`/feeds/${projectId}/releases.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const index = await response.json<{
      platforms: Record<string, { version: string; files: readonly { fileName: string }[] }>;
    }>();
    expect(Object.keys(index.platforms).toSorted()).toStrictEqual(["linux", "windows"]);
    expect(index.platforms["linux"]?.files.map((file) => file.fileName).toSorted()).toStrictEqual([
      "Example-Desktop-2.0.0.AppImage",
      "example-desktop-2.0.0.x86_64.rpm",
      "example-desktop_2.0.0_amd64.deb",
    ]);
  });

  it("serves an NSIS installer's blockmap, also under the old version's URL", async () => {
    const block = (seed: number, length: number) =>
      Buffer.from(Array.from({ length }, (_, index) => (index * 17 + seed) % 251));
    const v1 = Buffer.concat([block(1, 4096), block(2, 2048)]);
    const v2 = Buffer.concat([block(1, 4096), block(3, 3000)]);
    const installer = async (version: string, bytes: Buffer) => {
      const id = await completedBuild(
        {
          platform: "windows",
          distribution: "direct",
          artifactFormat: "exe",
          appVersion: version,
          metadata: { windows: { appName: "Example Desktop", architectures: ["x64"] } },
        },
        bytes,
      );
      await env.BUILD_BUCKET.put(`builds/${organizationId}/${projectId}/${id}.exe`, bytes);
      const response = await post(
        `/api/projects/${projectId}/desktop-releases`,
        {
          buildId: id,
          channel: "nsis-diff",
          sha512: sha512Of(bytes),
          electronBlockmap: {
            checksums: [`${version}-a`, `${version}-b`].map((name) =>
              Buffer.from(name).toString("base64"),
            ),
            sizes: [4096, bytes.byteLength - 4096],
          },
        },
        { cookie: cookies },
      );
      expect(response.status).toBe(201);
      const created = await response.json<{ id: string }>();
      return created.id;
    };
    await installer("3.0.0", v1);
    const v2Release = await installer("3.1.0", v2);

    const blockmap = async (fileName: string) => {
      const response = await get(
        `/feeds/${projectId}/windows/download/${v2Release}/${fileName}.blockmap`,
      );
      expect(response.status).toBe(200);
      const text = await new Response(
        response.body?.pipeThrough(new DecompressionStream("gzip")),
      ).text();
      return JSON.parse(text) as { files: readonly { checksums: readonly string[] }[] };
    };
    const checksums = (names: readonly string[]) =>
      names.map((name) => Buffer.from(name).toString("base64"));
    const own = await blockmap("Example-Desktop-Setup-3.1.0-x64.exe");
    expect(own.files[0]?.checksums).toStrictEqual(checksums(["3.1.0-a", "3.1.0-b"]));
    // electron-updater asks for the running version's blockmap under the new release's URL.
    const previous = await blockmap("Example-Desktop-Setup-3.0.0-x64.exe");
    expect(previous.files[0]?.checksums).toStrictEqual(checksums(["3.0.0-a", "3.0.0-b"]));

    const ranged = await get(`/feeds/${projectId}/windows/download/${v2Release}/x.exe`, {
      range: "bytes=0-9",
    });
    expect(ranged.status).toBe(206);
    expect(Buffer.from(await ranged.arrayBuffer())).toStrictEqual(v2.subarray(0, 10));

    // A Windows release is not served under another platform's directory.
    const crossPlatform = await get(`/feeds/${projectId}/linux/download/${v2Release}/x.exe`);
    expect(crossPlatform.status).toBe(404);
  });

  it("writes a Mac zip's minimum macOS as the Darwin version electron-updater compares", async () => {
    const zip = await completedBuild({
      platform: "macos",
      distribution: "developer-id",
      artifactFormat: "zip",
      appVersion: "4.0.0",
      metadata: { macos: { appName: "Example Desktop", minimumSystemVersion: "14.0" } },
    });
    await released(zip);
    await expect(feedText("macos/latest-mac.yml")).resolves.toContain(
      'minimumSystemVersion: "23.0.0"',
    );
  });
});
