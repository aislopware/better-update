import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { ed25519 } from "@noble/curves/ed25519.js";

import { parseTauriPublicKey, verifyTauriSignature } from "../../src/lib/tauri-signature";
import { setupCliE2E } from "../helpers/cli-e2e";
import { ascii, concat, deb, elf, rpm, tar, withBlockmap } from "../helpers/desktop-packages";

/**
 * Windows and Linux desktop builds through the real server: `builds upload`
 * and `build --platform linux` (custom command) record what each installer
 * or package says about itself, `windows|linux release create` signs and
 * publishes every unreleased build of the newest version, and the feeds the
 * updaters poll serve them — electron-updater channel files with the NSIS
 * blockmap and AppImage blockMapSize, the WinSparkle appcast with a
 * signature that verifies, the Tauri manifest, and the first-install link.
 *
 *   bun run test:e2e -- tests/e2e/desktop-windows-linux.test.ts
 */
const cli = setupCliE2E("e2e-cli-desktop-windows-linux", {
  noExpoConfig: true,
  appJsonTemplate: { expo: { name: "Desktop E2E App", slug: "desktop-e2e-app" } },
  userEmail: "cli-e2e-desktop-windows-linux@example.com",
  orgSlug: "cli-e2e-desktop-windows-linux-org",
});

const WINSPARKLE_SEED = randomBytes(32);
const WINSPARKLE_PUBLIC_KEY = Buffer.from(ed25519.getPublicKey(WINSPARKLE_SEED)).toString("base64");

// The throwaway `tauri signer generate -p test-pass` pair the unit tests use.
const TAURI_PRIVATE_KEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5ClJXUlRZMEl5UXd1Z2UxTWcyclNTWWpxTW5Wb0hWRW5wcnZHY0hJS0thNnVXUDZ5elNSb0FBQkFBQUFBQUFBQUFBQUlBQUFBQTlOY3BBRXdtNitTWS8vR3c3VmwxL3prYW5HWnBwVGt6d21WaUlZTm1CYS84cjFSRklBRlJRVkd3aUxZTTFyMUtwNE54M0RwbElUZENibmE0UEJ6S1lqcjZFc0RIdlBCVUppd0lXcjVmRGp1RzJNMmhsOE1lK1ZiZ0dWTlV6R0Mrc2VaMUI5Ym1ib0E9Cg==";
const TAURI_PUBLIC_KEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEE1NzMxMjNDMDkwMzBDMTcKUldRWERBTUpQQkp6cFMvaVVlR1VIbjFzcEx1TjVjcFdValhVWURWVHJFclpsMk9qV1RKT0VzVlIK";
const TAURI_KEY_PASSWORD = "test-pass";

const expectSuccess = (result: {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}) => {
  expect(
    result.exitCode === 0
      ? ""
      : `exit ${String(result.exitCode)}: ${result.stderr}\n${result.stdout}`,
  ).toBe("");
};

const jsonData = (stdout: string): unknown => (JSON.parse(stdout) as { data: unknown }).data;

interface BuildRow {
  readonly id: string;
  readonly platform: string;
  readonly appVersion: string | null;
  readonly bundleId: string | null;
  readonly artifact: { readonly format: string } | null;
  readonly metadataJson: string;
}

const listBuilds = async (platform: string): Promise<readonly BuildRow[]> => {
  const response = await cli.getAuthorized(
    `/api/builds?projectId=${cli.getProjectId()}&platform=${platform}&limit=50`,
  );
  expect(response.status).toBe(200);
  const { items } = (await response.json()) as { items: readonly { id: string }[] };
  return Promise.all(
    items.map(async ({ id }) => {
      const detail = await cli.getAuthorized(`/api/builds/${id}`);
      return (await detail.json()) as BuildRow;
    }),
  );
};

const feed = async (file: string, init?: Record<string, string>) => {
  const response = await cli.get(`/feeds/${cli.getProjectId()}/${file}`, init);
  return { status: response.status, text: await response.text(), headers: response.headers };
};

const sha512 = (bytes: Uint8Array) => createHash("sha512").update(bytes).digest("base64");

/** An NSIS-sized installer stand-in: random so the blockmap has many distinct chunks. */
const INSTALLER = concat(ascii("MZ"), randomBytes(300_000));
const MSI = concat(ascii("ÐÏ\u0011à"), randomBytes(50_000));
const APPIMAGE = withBlockmap(concat(elf(0x3e), randomBytes(120_000)));
const DEB_CONTROL =
  "Package: example-desktop\nVersion: 1.2.0\nArchitecture: arm64\nDescription: Example\n";
const DEB_ARM64 = deb("control.tar.gz", gzipSync(tar({ "./control": DEB_CONTROL })));
const RPM_X64 = rpm({ 1000: "example-desktop", 1001: "1.2.0", 1002: "1", 1022: "x86_64" });

const write = (relative: string, bytes: Uint8Array) => {
  const full = path.join(cli.getProjectDir(), relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, bytes);
  return full;
};

beforeAll(() => {
  const root = cli.getProjectDir();
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "example-desktop",
        productName: "Example Desktop",
        version: "1.2.0",
        build: { appId: "com.example.desktop" },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(root, "eas.json"),
    `${JSON.stringify(
      {
        projectId: cli.getProjectId(),
        build: {
          production: {
            environment: "production",
            windows: {
              minimumSystemVersion: "10.0.17763",
              winSparklePublicKey: WINSPARKLE_PUBLIC_KEY,
            },
            linux: {},
            custom: {
              linux: {
                command: "mkdir -p out && cp prebuilt/*.rpm out/",
                artifactPath: "out/*.{rpm,deb}",
              },
            },
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  write("prebuilt/example-desktop-1.2.0-1.x86_64.rpm", RPM_X64);
});

describe("Windows and Linux desktop distribution", () => {
  it("refuses an artifact of the other platform before uploading anything", () => {
    const appImage = write("dist/Example Desktop-1.2.0.AppImage", APPIMAGE.bytes);
    const exe = write("dist/Example Desktop Setup 1.2.0.exe", INSTALLER);
    const result = cli.runCli("builds", "upload", "--platform", "windows", exe, appImage);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("is not a Windows installer");
  });

  it("uploads every Windows installer as its own build with what the profile and app say", async () => {
    const exe = write("dist/Example Desktop Setup 1.2.0.exe", INSTALLER);
    const msi = write("dist/Example_Desktop_1.2.0_x64_en-US.msi", MSI);
    expectSuccess(cli.runCli("builds", "upload", "--platform", "windows", exe, msi));
    const builds = await listBuilds("windows");
    expect(
      builds
        .map((build) => build.artifact?.format)
        .toSorted((left, right) => (left ?? "").localeCompare(right ?? "")),
    ).toStrictEqual(["exe", "msi"]);
    const msiBuild = builds.find((build) => build.artifact?.format === "msi");
    expect(msiBuild).toMatchObject({ appVersion: "1.2.0", bundleId: "com.example.desktop" });
    expect(JSON.parse(msiBuild?.metadataJson ?? "{}")).toStrictEqual({
      windows: {
        appName: "Example Desktop",
        architectures: ["x64"],
        minimumSystemVersion: "10.0.17763",
        winSparklePublicKey: WINSPARKLE_PUBLIC_KEY,
      },
    });
  });

  it("refuses an unsigned Windows release when the app names a WinSparkle key", () => {
    const result = cli.runCli("windows", "release", "create");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("WinSparkle public key");
  });

  it("signs and releases both installers; the feeds serve them", async () => {
    const created = cli.runCliWithEnv(
      { WINSPARKLE_PRIVATE_KEY: WINSPARKLE_SEED.toString("base64") },
      "windows",
      "release",
      "create",
      "--json",
    );
    expectSuccess(created);
    const releases = jsonData(created.stdout) as readonly {
      id: string;
      artifactFormat: string;
      winSparkleSigned: boolean;
      blockmap: boolean;
    }[];
    expect(
      releases
        .map((release) => release.artifactFormat)
        .toSorted((left, right) => left.localeCompare(right)),
    ).toStrictEqual(["exe", "msi"]);
    expect(releases.every((release) => release.winSparkleSigned)).toBe(true);
    expect(releases.find((release) => release.artifactFormat === "exe")?.blockmap).toBe(true);

    const yml = await feed("windows/latest.yml");
    expect(yml.status).toBe(200);
    expect(yml.text).toContain('version: "1.2.0"');
    expect(yml.text).toContain(`sha512: "${sha512(INSTALLER)}"`);
    expect(yml.text).toContain('minimumSystemVersion: "10.0.17763"');
    expect(yml.text).not.toContain(".msi");

    const blockmapUrl = /url: "?(?<url>[^"\n]+\.exe)"?/u.exec(yml.text)?.groups?.["url"];
    expect(blockmapUrl).toBeDefined();
    const blockmap = await fetch(
      new URL(
        `${blockmapUrl ?? ""}.blockmap`,
        `${cli.getBaseUrl()}/feeds/${cli.getProjectId()}/windows/`,
      ),
    );
    expect(blockmap.status).toBe(200);

    const appcast = await feed("windows/appcast.xml");
    expect(appcast.status).toBe(200);
    const signature =
      /sparkle:os="windows-x64"[^>]*sparkle:edSignature="(?<sig>[^"]+)"|sparkle:edSignature="(?<sig2>[^"]+)"[^>]*sparkle:os="windows-x64"/u.exec(
        appcast.text,
      )?.groups;
    const edSignature = signature?.["sig"] ?? signature?.["sig2"];
    expect(edSignature).toBeDefined();
    expect(
      ed25519.verify(
        Buffer.from(edSignature ?? "", "base64"),
        INSTALLER,
        ed25519.getPublicKey(WINSPARKLE_SEED),
      ),
    ).toBe(true);

    // Staged: electron-updater gets the percentage; WinSparkle sees it only from a bucketed install.
    const exeRelease = releases.find((release) => release.artifactFormat === "exe");
    expectSuccess(
      cli.runCli("windows", "release", "rollout", exeRelease?.id ?? "", "--percentage", "40"),
    );
    const stagedYml = await feed("windows/latest.yml");
    expect(stagedYml.text).toContain("stagingPercentage: 40");
    const stagedAppcast = await feed("windows/appcast.xml");
    // The staged exe drops out of an un-bucketed appcast; the live MSI stands in for it.
    expect(stagedAppcast.text).not.toContain(".exe");
    expect(stagedAppcast.text).toContain(".msi");
  });

  it("finds nothing left to release on the same channel", () => {
    const again = cli.runCliWithEnv(
      { WINSPARKLE_PRIVATE_KEY: WINSPARKLE_SEED.toString("base64") },
      "windows",
      "release",
      "create",
    );
    expect(again.exitCode).not.toBe(0);
    expect(again.stderr + again.stdout).toContain("already released");
  });

  it("uploads Linux packages, reading arch from the ELF header and deb control", async () => {
    const appImage = write("dist/Example Desktop-1.2.0.AppImage", APPIMAGE.bytes);
    const debFile = write("dist/example-desktop_1.2.0_arm64.deb", DEB_ARM64);
    expectSuccess(cli.runCli("builds", "upload", "--platform", "linux", appImage, debFile));
    const builds = await listBuilds("linux");
    const metadata = Object.fromEntries(
      builds.map((build) => [build.artifact?.format, JSON.parse(build.metadataJson)]),
    );
    expect(metadata["appimage"]).toStrictEqual({
      linux: { appName: "Example Desktop", architectures: ["x64"], blockMapSize: APPIMAGE.size },
    });
    expect(metadata["deb"]).toStrictEqual({
      linux: {
        appName: "Example Desktop",
        architectures: ["arm64"],
        packageName: "example-desktop",
        // Kept whole for the APT repository's `Packages` index.
        debControl: DEB_CONTROL,
      },
    });
  });

  it("builds Linux with the profile's custom command, uploading what it wrote", async () => {
    expectSuccess(cli.runCli("build", "--platform", "linux", "--allow-dirty"));
    const linuxBuilds = await listBuilds("linux");
    const rpmBuild = linuxBuilds.find((build) => build.artifact?.format === "rpm");
    expect(rpmBuild).toMatchObject({ appVersion: "1.2.0", bundleId: "com.example.desktop" });
    expect(JSON.parse(rpmBuild?.metadataJson ?? "{}")).toMatchObject({
      linux: { architectures: ["x64"], packageName: "example-desktop" },
    });
  });

  it("releases the Linux packages to per-arch electron-updater files", async () => {
    expectSuccess(cli.runCli("linux", "release", "create", "--channel", "beta"));
    const x64 = await feed("linux/beta-linux.yml");
    expect(x64.status).toBe(200);
    expect(x64.text).toContain(`blockMapSize: ${String(APPIMAGE.size)}`);
    expect(x64.text).toContain(".AppImage");
    expect(x64.text).toContain(".rpm");
    const arm64 = await feed("linux/beta-linux-arm64.yml");
    expect(arm64.status).toBe(200);
    expect(arm64.text).toContain("_arm64.deb");
    expect(arm64.text).not.toContain(".AppImage");

    const download = await fetch(
      `${cli.getBaseUrl()}/feeds/${cli.getProjectId()}/linux/latest/download?channel=beta&format=deb&arch=aarch64`,
      { redirect: "manual" },
    );
    expect(download.status).toBe(302);
    expect(download.headers.get("location")).toContain("_arm64.deb");

    // electron-updater reads the new AppImage's blockmap off its tail with a range request.
    const appImageUrl = /url: "?(?<url>[^"\n]+\.AppImage)"?/u.exec(x64.text)?.groups?.["url"] ?? "";
    const tail = await fetch(
      new URL(appImageUrl, `${cli.getBaseUrl()}/feeds/${cli.getProjectId()}/linux/`),
      {
        headers: {
          Range: `bytes=${String(APPIMAGE.bytes.length - APPIMAGE.size - 4)}-${String(APPIMAGE.bytes.length - 1)}`,
        },
      },
    );
    expect(tail.status).toBe(206);
    expect(new Uint8Array(await tail.arrayBuffer())).toStrictEqual(
      APPIMAGE.bytes.subarray(APPIMAGE.bytes.length - APPIMAGE.size - 4),
    );
  });

  it("signs a Tauri app's AppImage for its updater pubkey and lists it in the Tauri manifest", async () => {
    const root = cli.getProjectDir();
    mkdirSync(path.join(root, "src-tauri"), { recursive: true });
    writeFileSync(
      path.join(root, "src-tauri", "tauri.conf.json"),
      JSON.stringify({
        productName: "Example Tauri",
        version: "2.0.0",
        identifier: "com.example.tauri",
        plugins: { updater: { pubkey: TAURI_PUBLIC_KEY } },
      }),
    );
    const tauriAppImage = concat(elf(0x3e), randomBytes(40_000));
    const appImage = write("dist/Example Tauri_2.0.0_amd64.AppImage", tauriAppImage);
    expectSuccess(cli.runCli("builds", "upload", "--platform", "linux", appImage));

    const unsigned = cli.runCli("linux", "release", "create");
    expect(unsigned.exitCode).not.toBe(0);
    expect(unsigned.stderr + unsigned.stdout).toContain("updater pubkey");

    expectSuccess(
      cli.runCliWithEnv(
        {
          TAURI_SIGNING_PRIVATE_KEY: TAURI_PRIVATE_KEY,
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: TAURI_KEY_PASSWORD,
        },
        "linux",
        "release",
        "create",
      ),
    );
    const manifest = await feed("tauri/latest.json?target=linux&arch=x86_64&bundle_type=appimage");
    expect(manifest.status).toBe(200);
    const body = JSON.parse(manifest.text) as { version: string; signature: string; url: string };
    expect(body.version).toBe("2.0.0");
    const publicKey = parseTauriPublicKey(TAURI_PUBLIC_KEY);
    expect(publicKey).toBeDefined();
    expect(
      publicKey === undefined
        ? undefined
        : verifyTauriSignature(publicKey, tauriAppImage, body.signature),
    ).toStrictEqual({ valid: true, signedVersion: "2.0.0" });
    expect(body.url).toContain(".AppImage");
  });
});
