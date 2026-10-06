import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { setupCliE2E } from "../helpers/cli-e2e";

/**
 * `build --platform macos` end to end: a real Xcode archive of a fixture with
 * the awkward Developer ID parts (embedded framework, XPC service, a tool in
 * `Contents/Helpers`), exported for Developer ID, packaged, and uploaded to a
 * real server; and a custom command whose ad-hoc output the CLI re-signs.
 *
 * Gated like `macos-distribution.test.ts` on a real Developer ID Application
 * `.p12` (codesign accepts only identities that chain to Apple):
 *
 *   E2E_MACOS_DEVELOPER_ID_P12=/path/to/developer-id.p12
 *   E2E_MACOS_DEVELOPER_ID_P12_PASSWORD=...
 *
 * Notarization stays off here (`"notarize": false`); it is the same code path
 * `macos-distribution.test.ts` exercises behind E2E_MACOS_NOTARIZE.
 */
const P12_PATH = process.env["E2E_MACOS_DEVELOPER_ID_P12"];
const P12_PASSWORD = process.env["E2E_MACOS_DEVELOPER_ID_P12_PASSWORD"];
const canBuild =
  process.platform === "darwin" && P12_PATH !== undefined && P12_PASSWORD !== undefined;

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../fixtures/macos-app");
const BUNDLE_ID = "com.example.macosfixture";

/**
 * The synthetic Sparkle key the fixture's `SUPublicEDKey` belongs to: a seed of
 * 32 bytes of 0x2a, base64 as `generate_keys -x` exports it.
 */
const SPARKLE_SEED = Buffer.alloc(32, 0x2a).toString("base64");
const SPARKLE_PUBLIC_KEY = "GX9rI+FshTLGq8g4+s1ep4m+DHaykgM0A5v6iz02jWE=";

const verifySparkle = (signature: string, bytes: Buffer): boolean =>
  verify(
    null,
    bytes,
    createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        Buffer.from(SPARKLE_PUBLIC_KEY, "base64"),
      ]),
      format: "der",
      type: "spki",
    }),
    Buffer.from(signature, "base64"),
  );

const cli = setupCliE2E("slow-cli-build-macos", {
  userEmail: "slow-cli-build-macos@example.com",
  orgSlug: "slow-cli-build-macos-org",
});

/** `codesign -dvvv` writes to stderr. */
const codesignDisplayOf = (target: string): string =>
  execFileSync("sh", ["-c", `codesign -dvvv "$1" 2>&1`, "sh", target], { encoding: "utf8" });

const entitlementsOf = (target: string): string =>
  execFileSync("sh", ["-c", `codesign -d --entitlements - --xml "$1" 2>/dev/null`, "sh", target], {
    encoding: "utf8",
  });

/** On failure the diff is the CLI's stderr, which is what explains a non-zero exit. */
const expectSuccess = (result: { readonly exitCode: number; readonly stderr: string }) => {
  expect(result.exitCode === 0 ? "" : `exit ${result.exitCode}: ${result.stderr}`).toBe("");
};

const run = (command: string, args: readonly string[]): string =>
  execFileSync(command, [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const CUSTOM_COMMAND = [
  "xcodebuild -project MacosFixture.xcodeproj -scheme MacosFixture -configuration Release",
  "-derivedDataPath build/dd CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual build",
].join(" ");

// Signs with the identity the CLI injects, then packages an unsigned DMG —
// the shape electron-builder / Tauri bundles hand over.
const CUSTOM_DMG_COMMAND = [
  "xcodebuild -project MacosFixture.xcodeproj -scheme MacosFixture -configuration Release",
  "-derivedDataPath build/dd-signed CODE_SIGN_STYLE=Manual",
  'CODE_SIGN_IDENTITY="$BETTER_UPDATE_MACOS_SIGNING_IDENTITY_NAME"',
  'DEVELOPMENT_TEAM="$BETTER_UPDATE_MACOS_TEAM_ID" ENABLE_HARDENED_RUNTIME=YES',
  "CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO",
  'OTHER_CODE_SIGN_FLAGS="--timestamp --keychain $BETTER_UPDATE_MACOS_KEYCHAIN" build',
  "&& mkdir -p out && hdiutil create -quiet -volname MacosFixture",
  "-srcfolder build/dd-signed/Build/Products/Release/MacosFixture.app -fs HFS+ -format UDZO",
  "-ov out/MacosFixture.dmg",
].join(" ");

const EAS_JSON = {
  projectType: "native",
  build: {
    "macos-dmg": { macos: { artifact: "dmg", notarize: false, universal: true } },
    "macos-custom-dmg": {
      macos: { notarize: false },
      custom: { macos: { command: CUSTOM_DMG_COMMAND, artifactPath: "out/*.dmg" } },
    },
    "macos-custom": {
      macos: { artifact: "zip", notarize: false },
      custom: {
        macos: {
          command: CUSTOM_COMMAND,
          artifactPath: "build/dd/Build/Products/Release/*.app",
        },
      },
    },
  },
};

/** Every code item that must carry its own Developer ID signature. */
const nestedCode = (app: string) => [
  app,
  path.join(app, "Contents", "Frameworks", "FixtureKit.framework"),
  path.join(app, "Contents", "XPCServices", "FixtureHelper.xpc"),
  path.join(app, "Contents", "Helpers", "fixture-tool"),
];

const expectDeveloperIdSigned = (app: string) => {
  run("codesign", ["--verify", "--deep", "--strict", app]);
  for (const item of nestedCode(app)) {
    const display = codesignDisplayOf(item);
    expect({ item, display }).toMatchObject({
      display: expect.stringContaining("Authority=Developer ID Application:"),
    });
    expect({ item, display }).toMatchObject({ display: expect.stringContaining("Timestamp=") });
  }
  // Executables carry the hardened runtime the notary requires.
  for (const executable of [
    path.join(app, "Contents", "MacOS", "MacosFixture"),
    path.join(app, "Contents", "Helpers", "fixture-tool"),
  ]) {
    expect(codesignDisplayOf(executable)).toMatch(/flags=0x\d+\(runtime\)/u);
  }
  const entitlements = entitlementsOf(app);
  expect(entitlements).toContain("com.apple.security.cs.allow-jit");
  expect(entitlements).not.toContain("get-task-allow");
};

const buildIdFrom = (stdout: string): string => {
  const match = /Build ID\s+(?<id>\S+)/u.exec(stdout);
  expect(match?.groups?.["id"]).toStrictEqual(expect.any(String));
  return match?.groups?.["id"] ?? "";
};

describe.skipIf(!canBuild)("CLI build journey — macOS Developer ID", () => {
  let workRoot = "";
  let dmgBuildId = "";
  let dmgPath = "";
  let zipBuildId = "";
  let zipPath = "";

  beforeAll(async () => {
    workRoot = mkdtempSync(path.join(os.tmpdir(), "build-macos-e2e-"));
    const projectDir = cli.getProjectDir();
    cpSync(FIXTURE_DIR, projectDir, { recursive: true });
    // Xcode applies XCODE_XCCONFIG_FILE to every target: installing the
    // framework, XPC service and tool too turns the archive generic.
    const skipInstallNo = path.join(workRoot, "skip-install-no.xcconfig");
    writeFileSync(skipInstallNo, "SKIP_INSTALL = NO\n");
    const easJson = {
      ...EAS_JSON,
      build: {
        ...EAS_JSON.build,
        "macos-generic": {
          macos: { artifact: "zip", notarize: false },
          env: { XCODE_XCCONFIG_FILE: skipInstallNo },
        },
      },
    };
    writeFileSync(path.join(projectDir, "eas.json"), `${JSON.stringify(easJson, null, 2)}\n`);
    await cli.bootstrapOrgVault();
    expectSuccess(cli.runCli("init"));
    expectSuccess(
      cli.runCli(
        "credentials",
        "upload",
        "--platform",
        "macos",
        "--type",
        "macos-certificate",
        "--name",
        "E2E Developer ID",
        "--file",
        P12_PATH!,
        "--password",
        P12_PASSWORD!,
      ),
    );
  });

  afterAll(() => {
    if (workRoot !== "") {
      rmSync(workRoot, { recursive: true, force: true });
    }
  });

  test("archives, exports for Developer ID, packages a DMG and uploads it", () => {
    const output = path.join(workRoot, "MacosFixture.dmg");
    const result = cli.runCli(
      "build",
      "--platform",
      "macos",
      "--profile",
      "macos-dmg",
      "--allow-dirty",
      "--output",
      output,
    );
    expectSuccess(result);
    expect(existsSync(output)).toBe(true);

    const dmgDisplay = codesignDisplayOf(output);
    expect(dmgDisplay).toContain(`Identifier=${BUNDLE_ID}.dmg`);
    expect(dmgDisplay).toContain("Authority=Developer ID Application:");

    const mountPoint = path.join(workRoot, "mnt");
    run("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint, output]);
    try {
      const app = path.join(mountPoint, "MacosFixture.app");
      expectDeveloperIdSigned(app);
      expect(run("lipo", ["-archs", path.join(app, "Contents", "MacOS", "MacosFixture")])).toMatch(
        /(?=.*arm64)(?=.*x86_64)/u,
      );
      expect(existsSync(path.join(mountPoint, "Applications"))).toBe(true);
    } finally {
      run("hdiutil", ["detach", mountPoint, "-force"]);
    }

    const buildId = buildIdFrom(result.stdout);
    dmgBuildId = buildId;
    dmgPath = output;
    const view = cli.runCli("builds", "get", buildId, "--json");
    expectSuccess(view);
    expect(JSON.parse(view.stdout).data).toMatchObject({
      Platform: "macos",
      Distribution: "developer-id",
      "Bundle ID": BUNDLE_ID,
      Version: "1.4.0",
      "Build Number": "140",
      "Runtime Version": "-",
      Artifact: expect.stringMatching(/^dmg /u),
      Notarization: "skipped",
      "Minimum macOS": "13.0",
      Architectures: expect.stringMatching(/(?=.*arm64)(?=.*x86_64)/u),
      "Team ID": expect.stringMatching(/^[A-Z0-9]{10}$/u),
    });
  });

  test("re-signs what a custom command built and ships it as a zip", () => {
    const output = path.join(workRoot, "MacosFixture.zip");
    const result = cli.runCli(
      "build",
      "--platform",
      "macos",
      "--profile",
      "macos-custom",
      "--allow-dirty",
      "--output",
      output,
    );
    expectSuccess(result);
    // The ad-hoc build fails the audit, so the CLI says why before repairing.
    expect(result.stderr).toContain("Re-signing MacosFixture.app");
    zipBuildId = buildIdFrom(result.stdout);
    zipPath = output;

    const unpacked = path.join(workRoot, "unzipped");
    run("ditto", ["-x", "-k", output, unpacked]);
    expectDeveloperIdSigned(path.join(unpacked, "MacosFixture.app"));
    expect(readFileSync(output).subarray(0, 2).toString("latin1")).toBe("PK");
  });

  test("takes a DMG a custom command packaged, audits the app inside and signs the image", () => {
    const output = path.join(workRoot, "MacosFixture-custom.dmg");
    const result = cli.runCli(
      "build",
      "--platform",
      "macos",
      "--profile",
      "macos-custom-dmg",
      "--allow-dirty",
      "--no-upload",
      "--output",
      output,
    );
    expectSuccess(result);
    expect(result.stdout).toContain("Signing MacosFixture.dmg");
    const display = codesignDisplayOf(output);
    expect(display).toContain(`Identifier=${BUNDLE_ID}.dmg`);
    expect(display).toContain("Authority=Developer ID Application:");
  });

  test("signs a Generic Xcode Archive's app itself instead of failing the export", () => {
    const output = path.join(workRoot, "MacosFixture-generic.zip");
    const result = cli.runCli(
      "build",
      "--platform",
      "macos",
      "--profile",
      "macos-generic",
      "--allow-dirty",
      "--no-upload",
      "--output",
      output,
    );
    expectSuccess(result);
    expect(result.stderr).toContain("Generic Xcode Archive");

    const unpacked = path.join(workRoot, "unzipped-generic");
    run("ditto", ["-x", "-k", output, unpacked]);
    expectDeveloperIdSigned(path.join(unpacked, "MacosFixture.app"));
  });

  test("releases the builds to Sparkle and electron-updater feeds", async () => {
    // The app carries SUPublicEDKey, so it would reject an unsigned update.
    const unsigned = cli.runCli("macos", "release", "create", dmgBuildId, "--file", dmgPath);
    expect(unsigned.exitCode).not.toBe(0);
    expect(unsigned.stderr).toContain(`SUPublicEDKey ${SPARKLE_PUBLIC_KEY}`);

    const wrongKey = path.join(workRoot, "wrong-sparkle.key");
    writeFileSync(wrongKey, Buffer.alloc(32, 1).toString("base64"));
    const mismatched = cli.runCli(
      "macos",
      "release",
      "create",
      dmgBuildId,
      "--sparkle-key-file",
      wrongKey,
      "--file",
      dmgPath,
    );
    expect(mismatched.exitCode).not.toBe(0);
    expect(mismatched.stderr).toContain("the app would reject this release");

    // Downloads the stored DMG itself (no --file), signs it with the env key.
    const created = cli.runCliWithEnv(
      { SPARKLE_PRIVATE_KEY: SPARKLE_SEED },
      "macos",
      "release",
      "create",
      dmgBuildId,
      "--notes",
      "Signed in the e2e",
      "--json",
    );
    expectSuccess(created);
    const dmgRelease = JSON.parse(created.stdout).data;
    expect(dmgRelease).toMatchObject({
      buildId: dmgBuildId,
      channel: "latest",
      artifactFormat: "dmg",
      appVersion: "1.4.0",
      buildNumber: "140",
      sparkleSigned: true,
      rolloutPercentage: 100,
    });
    // Through the harness client, which retries its loopback connection resets.
    const feedBase = `/feeds/${String(dmgRelease.projectId)}/macos`;
    const fetchText = async (feedPath: string) => {
      const response = await cli.get(feedPath);
      return response.text();
    };
    const fetchStatus = async (feedPath: string) => {
      const response = await cli.get(feedPath);
      return response.status;
    };

    const appcast = await fetchText(`${feedBase}/appcast.xml`);
    expect(appcast).toContain("<sparkle:shortVersionString>1.4.0</sparkle:shortVersionString>");
    expect(appcast).toContain("<sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion>");
    const enclosure =
      /<enclosure url="(?<url>[^"]+)" length="(?<size>\d+)"[^>]*sparkle:edSignature="(?<signature>[^"]+)"/u.exec(
        appcast,
      )?.groups ?? {};
    expect(enclosure["url"]).toMatch(/\/download\/[^/]+\/MacosFixture-1\.4\.0\.dmg$/u);
    // What a Mac downloads through the feed is the signed, stored DMG.
    // The enclosure is absolute; the redirect it answers leads to R2.
    const download = await cli.get(new URL(enclosure["url"] ?? "").pathname);
    const downloaded = Buffer.from(await download.arrayBuffer());
    expect(downloaded.equals(readFileSync(dmgPath))).toBe(true);
    expect(enclosure["size"]).toBe(String(downloaded.byteLength));
    expect(verifySparkle(enclosure["signature"] ?? "", downloaded)).toBe(true);

    const keyFile = path.join(workRoot, "sparkle.key");
    const missingKey = cli.runCli(
      "macos",
      "release",
      "create",
      zipBuildId,
      "--channel",
      "beta",
      "--rollout",
      "50",
      "--sparkle-key-file",
      keyFile,
      "--file",
      zipPath,
    );
    expect(missingKey.stderr).toContain("Could not read --sparkle-key-file");

    // electron-updater gets the zip, staged; --file skips the download.
    writeFileSync(keyFile, `${SPARKLE_SEED}\n`);
    const zipRelease = cli.runCli(
      "macos",
      "release",
      "create",
      zipBuildId,
      "--channel",
      "beta",
      "--rollout",
      "50",
      "--sparkle-key-file",
      keyFile,
      "--file",
      zipPath,
      "--json",
    );
    expectSuccess(zipRelease);
    const zipReleaseData = JSON.parse(zipRelease.stdout).data;
    // A zip carries the blockmap electron-updater's differential download needs.
    expect(zipReleaseData).toMatchObject({ artifactFormat: "zip", blockmap: true });
    const zipReleaseId: string = zipReleaseData.id;
    const yml = await fetchText(`${feedBase}/beta-mac.yml`);
    const zipSha512 = createHash("sha512").update(readFileSync(zipPath)).digest("base64");
    expect(yml).toContain(`sha512: "${zipSha512}"`);
    expect(yml).toContain("stagingPercentage: 50");
    expect(yml).toContain('version: "1.4.0"');

    const list = cli.runCli("macos", "release", "list", "--json");
    expectSuccess(list);
    expect(JSON.parse(list.stdout).data.items).toMatchObject([
      { ID: zipReleaseId, Channel: "beta", Format: "zip", State: "50%", Signed: "sparkle" },
      { ID: dmgRelease.id, Channel: "latest", Format: "dmg", State: "live", Signed: "sparkle" },
    ]);

    expectSuccess(cli.runCli("macos", "release", "halt", zipReleaseId));
    await expect(fetchStatus(`${feedBase}/beta-mac.yml`)).resolves.toBe(404);
    expectSuccess(cli.runCli("macos", "release", "resume", zipReleaseId));
    expectSuccess(cli.runCli("macos", "release", "rollout", zipReleaseId, "--percentage", "100"));
    const widened = await fetchText(`${feedBase}/beta-mac.yml`);
    expect(widened).not.toContain("stagingPercentage");
    expectSuccess(cli.runCli("macos", "release", "delete", zipReleaseId));
    await expect(fetchStatus(`${feedBase}/beta-mac.yml`)).resolves.toBe(404);
  });

  test("fails fast on a profile without a macos section", () => {
    writeFileSync(
      path.join(cli.getProjectDir(), "eas.json"),
      `${JSON.stringify({ ...EAS_JSON, build: { ...EAS_JSON.build, ios: { ios: { distribution: "ad-hoc" } } } }, null, 2)}\n`,
    );
    const result = cli.runCli(
      "build",
      "--platform",
      "macos",
      "--profile",
      "ios",
      "--allow-dirty",
      "--no-upload",
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Profile "ios" has no macos section');
  });
});
