import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { setupCliE2E } from "../helpers/cli-e2e";

/**
 * Real Developer ID signing, packaging and (optionally) notarization through
 * the CLI against a fixture app shaped like the hard cases seen in the wild:
 * a sidecar executable next to the main one in `Contents/MacOS` (Tauri
 * `externalBin`), an XPC service carrying its own entitlements, a loose dylib,
 * and an outer app built with `get-task-allow`.
 *
 * Gated on a real Developer ID Application `.p12`: codesign only accepts
 * identities that chain to Apple (`find-identity -v`), so a self-signed
 * certificate cannot stand in.
 *
 *   E2E_MACOS_DEVELOPER_ID_P12=/path/to/developer-id.p12
 *   E2E_MACOS_DEVELOPER_ID_P12_PASSWORD=...
 *
 * Notarization additionally needs a team App Store Connect key and real time
 * at Apple (minutes; hours for a new certificate's first submissions):
 *
 *   E2E_MACOS_NOTARIZE=1 E2E_ASC_KEY_PATH=... E2E_ASC_KEY_ID=... E2E_ASC_ISSUER_ID=...
 */
const P12_PATH = process.env["E2E_MACOS_DEVELOPER_ID_P12"];
const P12_PASSWORD = process.env["E2E_MACOS_DEVELOPER_ID_P12_PASSWORD"];
const canSign =
  process.platform === "darwin" && P12_PATH !== undefined && P12_PASSWORD !== undefined;
const ASC_KEY_PATH = process.env["E2E_ASC_KEY_PATH"];
const ASC_KEY_ID = process.env["E2E_ASC_KEY_ID"];
const ASC_ISSUER_ID = process.env["E2E_ASC_ISSUER_ID"];
const canNotarize =
  canSign &&
  process.env["E2E_MACOS_NOTARIZE"] === "1" &&
  ASC_KEY_PATH !== undefined &&
  ASC_KEY_ID !== undefined;

const BUNDLE_ID = "com.example.macos-fixture";

const cli = setupCliE2E("slow-cli-macos", {
  userEmail: "slow-cli-macos@example.com",
  orgSlug: "slow-cli-macos-org",
});

const run = (command: string, args: readonly string[]): string =>
  execFileSync(command, [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

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

const plist = (entries: Record<string, string>): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    ...Object.entries(entries).map(([key, value]) => `<key>${key}</key><string>${value}</string>`),
    "</dict></plist>",
  ].join("\n");

const entitlementsPlist = (keys: readonly string[]): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    ...keys.map((key) => `<key>${key}</key><true/>`),
    "</dict></plist>",
  ].join("\n");

const compile = (outputPath: string, source: string, extra: readonly string[] = []) => {
  const sourcePath = `${outputPath}.c`;
  writeFileSync(sourcePath, source);
  run("clang", [
    "-arch",
    "arm64",
    "-arch",
    "x86_64",
    "-O2",
    ...extra,
    "-o",
    outputPath,
    sourcePath,
  ]);
  rmSync(sourcePath);
};

/** Build the fixture app, ad-hoc signed the way a fresh local build is. */
const buildFixtureApp = (root: string): string => {
  const app = path.join(root, "Fixture.app");
  const macos = path.join(app, "Contents", "MacOS");
  const xpc = path.join(app, "Contents", "XPCServices", "Helper.xpc");
  mkdirSync(macos, { recursive: true });
  mkdirSync(path.join(xpc, "Contents", "MacOS"), { recursive: true });
  mkdirSync(path.join(app, "Contents", "Frameworks"), { recursive: true });

  writeFileSync(
    path.join(app, "Contents", "Info.plist"),
    plist({
      CFBundleIdentifier: BUNDLE_ID,
      CFBundleExecutable: "Fixture",
      CFBundlePackageType: "APPL",
      CFBundleShortVersionString: "1.0.0",
      CFBundleVersion: "1",
    }),
  );
  compile(path.join(macos, "Fixture"), "int main(void) { return 0; }\n");
  compile(path.join(macos, "fixture-sidecar"), "int main(void) { return 0; }\n");
  compile(
    path.join(app, "Contents", "Frameworks", "libfixture.dylib"),
    "int fixture(void) { return 1; }\n",
    ["-dynamiclib"],
  );
  writeFileSync(
    path.join(xpc, "Contents", "Info.plist"),
    plist({
      CFBundleIdentifier: `${BUNDLE_ID}.helper`,
      CFBundleExecutable: "Helper",
      CFBundlePackageType: "XPC!",
    }),
  );
  compile(path.join(xpc, "Contents", "MacOS", "Helper"), "int main(void) { return 0; }\n");

  // Universal (lipo'd) outputs carry no linker signature; ad-hoc sign the
  // loose code the way a thin cargo/ld build leaves it.
  run("codesign", [
    "--force",
    "--sign",
    "-",
    path.join(macos, "fixture-sidecar"),
    path.join(app, "Contents", "Frameworks", "libfixture.dylib"),
  ]);
  const xpcEntitlements = path.join(root, "xpc.entitlements");
  writeFileSync(
    xpcEntitlements,
    entitlementsPlist(["com.apple.security.cs.disable-library-validation"]),
  );
  run("codesign", ["--force", "--sign", "-", "--entitlements", xpcEntitlements, xpc]);
  const appEntitlements = path.join(root, "app.entitlements");
  writeFileSync(
    appEntitlements,
    entitlementsPlist(["com.apple.security.cs.allow-jit", "com.apple.security.get-task-allow"]),
  );
  run("codesign", ["--force", "--sign", "-", "--entitlements", appEntitlements, app]);
  return app;
};

describe.skipIf(!canSign)("macOS Developer ID distribution (real codesign)", () => {
  let workRoot = "";
  let appPath = "";

  beforeAll(async () => {
    workRoot = mkdtempSync(path.join(os.tmpdir(), "macos-e2e-"));
    appPath = buildFixtureApp(workRoot);
    await cli.bootstrapOrgVault();
    // Credentials are created against the linked project (the robot is a
    // project maintainer, not an org admin).
    expectSuccess(cli.runCli("init"));
    const upload = cli.runCli(
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
    );
    expectSuccess(upload);
  });

  afterAll(() => {
    if (workRoot !== "") {
      rmSync(workRoot, { recursive: true, force: true });
    }
  });

  test("refuses to package an app that is not Developer ID-signed yet", () => {
    const result = cli.runCli("macos", "package", appPath, "--format", "dmg", "--no-notarize");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not ready for Developer ID distribution");
    expect(result.stderr).toContain("Fixture.app/Contents/MacOS/fixture-sidecar");
  });

  test("signs every nested item inside-out, keeping entitlements and dropping get-task-allow", () => {
    const result = cli.runCli("macos", "sign", appPath);
    expectSuccess(result);
    expect(result.stdout).toContain("Signed and verified.");

    run("codesign", ["--verify", "--deep", "--strict", appPath]);
    for (const item of [
      appPath,
      path.join(appPath, "Contents", "MacOS", "fixture-sidecar"),
      path.join(appPath, "Contents", "XPCServices", "Helper.xpc"),
      path.join(appPath, "Contents", "Frameworks", "libfixture.dylib"),
    ]) {
      const display = codesignDisplayOf(item);
      expect({ item, display }).toMatchObject({
        display: expect.stringContaining("Authority=Developer ID Application:"),
      });
      expect({ item, display }).toMatchObject({
        display: expect.stringMatching(/flags=0x\d+\(runtime\)/u),
      });
      expect({ item, display }).toMatchObject({ display: expect.stringContaining("Timestamp=") });
    }

    // The sidecar had only a linker/ad-hoc identity — it gets a real one.
    expect(codesignDisplayOf(path.join(appPath, "Contents", "MacOS", "fixture-sidecar"))).toContain(
      `Identifier=${BUNDLE_ID}.fixture-sidecar`,
    );
    // Nested entitlements survive the re-sign …
    expect(entitlementsOf(path.join(appPath, "Contents", "XPCServices", "Helper.xpc"))).toContain(
      "com.apple.security.cs.disable-library-validation",
    );
    // … and the app keeps allow-jit but loses get-task-allow.
    const appEntitlements = entitlementsOf(appPath);
    expect(appEntitlements).toContain("com.apple.security.cs.allow-jit");
    expect(appEntitlements).not.toContain("get-task-allow");
  });

  test("signs a bare CLI binary under the fixed identifier the Keychain recognises it by", () => {
    const toolPath = path.join(workRoot, "example-tool");
    const source = path.join(workRoot, "example-tool.c");
    writeFileSync(source, "int main(void) { return 0; }\n");
    // A fresh linker output, like `bun build --compile`: identifier `a.out`-style, ad-hoc.
    run("clang", ["-o", toolPath, source]);

    const result = cli.runCli("macos", "sign", toolPath, "--identifier", "com.example.tool");
    expectSuccess(result);
    run("codesign", ["--verify", "--strict", toolPath]);
    const display = codesignDisplayOf(toolPath);
    expect(display).toContain("Identifier=com.example.tool");
    expect(display).toContain("Authority=Developer ID Application:");
    expect(display).toMatch(/flags=0x\d+\(runtime\)/u);
    // Identifier + team is the designated requirement every release shares.
    const requirement = execFileSync("sh", ["-c", `codesign -d -r- "$1" 2>&1`, "sh", toolPath], {
      encoding: "utf8",
    });
    expect(requirement).toMatch(
      /designated => identifier "com\.example\.tool" and anchor apple generic .*certificate leaf\[subject\.OU\] = [A-Z0-9]{10}/u,
    );
    execFileSync(toolPath);

    // A bundle is identified by its CFBundleIdentifier.
    const onApp = cli.runCli("macos", "sign", appPath, "--identifier", "com.example.other");
    expect(onApp.exitCode).not.toBe(0);
    expect(onApp.stderr).toContain("--identifier applies to a bare binary");
  });

  test("packages a signed DMG with an explicit identifier", () => {
    const dmgPath = path.join(workRoot, "Fixture.dmg");
    const result = cli.runCli(
      "macos",
      "package",
      appPath,
      "--format",
      "dmg",
      "--output",
      dmgPath,
      "--no-notarize",
    );
    expectSuccess(result);
    expect(existsSync(dmgPath)).toBe(true);
    const display = codesignDisplayOf(dmgPath);
    expect(display).toContain(`Identifier=${BUNDLE_ID}.dmg`);
    expect(display).toContain("Format=disk image");
    run("codesign", ["--verify", "--strict", dmgPath]);
  });

  test("packages a zip that round-trips the signed app", () => {
    const zipPath = path.join(workRoot, "Fixture.zip");
    const result = cli.runCli(
      "macos",
      "package",
      appPath,
      "--format",
      "zip",
      "--output",
      zipPath,
      "--no-notarize",
    );
    expectSuccess(result);
    const unpacked = path.join(workRoot, "unzipped");
    run("ditto", ["-x", "-k", zipPath, unpacked]);
    run("codesign", ["--verify", "--deep", "--strict", path.join(unpacked, "Fixture.app")]);
  });

  test.skipIf(!canNotarize)(
    "notarizes and staples the DMG",
    () => {
      const keyUpload = cli.runCli(
        "credentials",
        "upload",
        "--platform",
        "ios",
        "--type",
        "asc-api-key",
        "--name",
        "E2E notary key",
        "--file",
        ASC_KEY_PATH!,
        "--key-id",
        ASC_KEY_ID!,
        ...(ASC_ISSUER_ID === undefined ? [] : ["--issuer-id", ASC_ISSUER_ID]),
      );
      expectSuccess(keyUpload);
      const keyId = /^ID\s+(?<id>\S+)$/mu.exec(keyUpload.stdout)?.groups?.["id"];
      expect(keyId).toBeDefined();

      const dmgPath = path.join(workRoot, "Fixture-notarized.dmg");
      const result = cli.runCli(
        "macos",
        "package",
        appPath,
        "--format",
        "dmg",
        "--output",
        dmgPath,
        "--asc-key-id",
        keyId!,
      );
      expectSuccess(result);
      run("xcrun", ["stapler", "validate", dmgPath]);
      const assessment = execFileSync(
        "sh",
        [
          "-c",
          `spctl -a -t open -vvv --context context:primary-signature "$1" 2>&1`,
          "sh",
          dmgPath,
        ],
        { encoding: "utf8" },
      );
      expect(assessment).toContain("source=Notarized Developer ID");
    },
    4 * 60 * 60 * 1000,
  );
});
