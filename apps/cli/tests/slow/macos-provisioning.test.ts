import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import AppleUtils from "@expo/apple-utils";

import { setupCliE2E } from "../helpers/cli-e2e";

/**
 * Developer ID provisioning profiles against the real Apple Developer account:
 * a fixture app claiming a restricted entitlement (associated domains) is
 * built with `build --platform macos`, which must create a `MAC_APP_DIRECT`
 * profile, select it per target in the Xcode project, export with it, and
 * produce an app the kernel lets run.
 *
 * Writes to the Apple account (registers a bundle id, enables a capability,
 * creates profiles — all removed afterwards), so it is gated on credentials
 * and on a bundle id the account may register:
 *
 *   E2E_MACOS_DEVELOPER_ID_P12=… E2E_MACOS_DEVELOPER_ID_P12_PASSWORD=…
 *   E2E_ASC_KEY_PATH=… E2E_ASC_KEY_ID=… E2E_ASC_ISSUER_ID=…
 *   E2E_MACOS_PROFILE_BUNDLE_ID=<reverse-DNS id under the team's control>
 */
const P12_PATH = process.env["E2E_MACOS_DEVELOPER_ID_P12"];
const P12_PASSWORD = process.env["E2E_MACOS_DEVELOPER_ID_P12_PASSWORD"];
const ASC_KEY_PATH = process.env["E2E_ASC_KEY_PATH"];
const ASC_KEY_ID = process.env["E2E_ASC_KEY_ID"];
const ASC_ISSUER_ID = process.env["E2E_ASC_ISSUER_ID"];
const BUNDLE_ID = process.env["E2E_MACOS_PROFILE_BUNDLE_ID"];
const canRun =
  process.platform === "darwin" &&
  P12_PATH !== undefined &&
  P12_PASSWORD !== undefined &&
  ASC_KEY_PATH !== undefined &&
  ASC_KEY_ID !== undefined &&
  ASC_ISSUER_ID !== undefined &&
  BUNDLE_ID !== undefined;

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../fixtures/macos-app");
const FIXTURE_BUNDLE_ID = "com.example.macosfixture";

const cli = setupCliE2E("slow-cli-macos-provisioning", {
  userEmail: "slow-cli-macos-provisioning@example.com",
  orgSlug: "slow-cli-macos-provisioning-org",
});

const run = (command: string, args: readonly string[]): string =>
  execFileSync(command, [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const expectSuccess = (result: {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}) => {
  // The build's own log (xcodebuild's errors) is on stdout.
  expect(
    result.exitCode === 0
      ? ""
      : `exit ${result.exitCode}: ${result.stderr}\n${result.stdout.slice(-6000)}`,
  ).toBe("");
};

const ascContext = () => ({
  token: new AppleUtils.Token({
    key: readFileSync(ASC_KEY_PATH!, "utf8"),
    issuerId: ASC_ISSUER_ID!,
    keyId: ASC_KEY_ID!,
  }),
});

/** Remove what the test made on Apple: the bundle id's profiles, then the bundle id. */
const cleanUpApple = async () => {
  const ctx = ascContext();
  const bundleId = await AppleUtils.BundleId.findAsync(ctx, { identifier: BUNDLE_ID! });
  if (bundleId === null) {
    return;
  }
  const profiles = await bundleId.getProfilesAsync();
  await Promise.all(profiles.map(async (profile) => profile.deleteAsync()));
  await AppleUtils.BundleId.deleteAsync(ctx, { id: bundleId.id });
};

/** Whether the app's executable is still running after a few seconds (the kernel kills it at exec otherwise). */
const survivesLaunch = async (appPath: string): Promise<boolean> => {
  const child = spawn(path.join(appPath, "Contents", "MacOS", "MacosFixture"), [], {
    stdio: "ignore",
  });
  const exited = new Promise<boolean>((resolve) => {
    child.once("exit", () => resolve(false));
  });
  const alive = await Promise.race([
    exited,
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(true);
      }, 4000);
    }),
  ]);
  child.kill("SIGKILL");
  return alive;
};

describe.skipIf(!canRun)("CLI build journey — Developer ID provisioning profile", () => {
  let workRoot = "";
  let ascKeyRowId = "";

  beforeAll(async () => {
    workRoot = mkdtempSync(path.join(os.tmpdir(), "macos-profile-e2e-"));
    await cleanUpApple();
    const projectDir = cli.getProjectDir();
    cpSync(FIXTURE_DIR, projectDir, { recursive: true });
    // The app (not its nested framework/XPC/tool) takes the account's bundle id
    // and claims associated domains, which only a profile authorizes.
    const pbxproj = path.join(projectDir, "MacosFixture.xcodeproj", "project.pbxproj");
    writeFileSync(
      pbxproj,
      readFileSync(pbxproj, "utf8").replaceAll(
        `PRODUCT_BUNDLE_IDENTIFIER = ${FIXTURE_BUNDLE_ID};`,
        `PRODUCT_BUNDLE_IDENTIFIER = ${BUNDLE_ID!};`,
      ),
    );
    writeFileSync(
      path.join(projectDir, "MacosFixture", "MacosFixture.entitlements"),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0"><dict>',
        "<key>com.apple.security.cs.allow-jit</key><true/>",
        "<key>com.apple.developer.associated-domains</key>",
        "<array><string>applinks:example.com</string></array>",
        "</dict></plist>",
      ].join("\n"),
    );
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
    const keyUpload = cli.runCli(
      "credentials",
      "upload",
      "--platform",
      "ios",
      "--type",
      "asc-api-key",
      "--name",
      "E2E ASC key",
      "--file",
      ASC_KEY_PATH!,
      "--key-id",
      ASC_KEY_ID!,
      "--issuer-id",
      ASC_ISSUER_ID!,
    );
    expectSuccess(keyUpload);
    ascKeyRowId = /^ID\s+(?<id>\S+)$/mu.exec(keyUpload.stdout)?.groups?.["id"] ?? "";
    expect(ascKeyRowId).not.toBe("");
    writeFileSync(
      path.join(projectDir, "eas.json"),
      `${JSON.stringify(
        {
          projectType: "native",
          build: {
            "macos-profile": {
              macos: { artifact: "zip", notarize: false, ascApiKeyId: ascKeyRowId },
            },
          },
        },
        null,
        2,
      )}\n`,
    );
  });

  afterAll(async () => {
    if (canRun) {
      await cleanUpApple();
    }
    if (workRoot !== "") {
      rmSync(workRoot, { recursive: true, force: true });
    }
  });

  const build = (output: string) =>
    cli.runCli(
      "build",
      "--platform",
      "macos",
      "--profile",
      "macos-profile",
      "--allow-dirty",
      "--no-upload",
      "--output",
      output,
    );

  test("names the capability to enable when the App ID cannot grant the entitlement", () => {
    const result = build(path.join(workRoot, "refused.zip"));
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(`The App ID ${BUNDLE_ID!} does not have the capabilities`);
    expect(result.stderr).toContain("com.apple.developer.associated-domains");
  });

  test("creates and embeds a Developer ID profile once the capability is on", async () => {
    expectSuccess(
      cli.runCli(
        "credentials",
        "capability",
        "enable",
        "--identifier",
        BUNDLE_ID!,
        "--capability",
        "ASSOCIATED_DOMAINS",
        "--asc-api-key-id",
        ascKeyRowId,
      ),
    );
    const output = path.join(workRoot, "MacosFixture.zip");
    const result = build(output);
    expectSuccess(result);
    expect(result.stdout + result.stderr).toContain(
      `Creating a Developer ID provisioning profile for ${BUNDLE_ID!}`,
    );

    const unpacked = path.join(workRoot, "unzipped");
    run("ditto", ["-x", "-k", output, unpacked]);
    const app = path.join(unpacked, "MacosFixture.app");
    const embedded = path.join(app, "Contents", "embedded.provisionprofile");
    expect(existsSync(embedded)).toBe(true);
    const profile = run("security", ["cms", "-D", "-i", embedded]);
    expect(profile).toContain("<key>ProvisionsAllDevices</key>");
    expect(profile).toContain(BUNDLE_ID!);

    const entitlements = execFileSync(
      "sh",
      ["-c", `codesign -d --entitlements - --xml "$1" 2>/dev/null`, "sh", app],
      { encoding: "utf8" },
    );
    expect(entitlements).toContain("com.apple.developer.associated-domains");
    expect(entitlements).toContain("com.apple.application-identifier");
    run("codesign", ["--verify", "--deep", "--strict", app]);
    // The kernel only lets a restricted entitlement through with a profile
    // that authorizes it: a launch that survives proves the profile is right.
    await expect(survivesLaunch(app)).resolves.toBe(true);

    const listed = cli.runCli("credentials", "list", "--type", "provisioning-profile", "--json");
    expectSuccess(listed);
    expect(listed.stdout).toContain("DEVELOPER_ID");
  });

  test("reuses the stored profile on the next build", () => {
    const result = build(path.join(workRoot, "MacosFixture-again.zip"));
    expectSuccess(result);
    expect(result.stdout + result.stderr).not.toContain(
      "Creating a Developer ID provisioning profile",
    );
  });
});
