import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { applyAndroidVersion } from "../../lib/android-version-sync";
import { materializeEnvFile } from "../../lib/env-materialize";
import { applyTargetSigning } from "../../lib/ios-codesign-pbxproj";
import { buildSigningEntries } from "../../lib/ios-signing-entries";
import { makeOutputModeLayer } from "../../lib/output-mode";
import { discoverSignedTargets } from "../../lib/xcode-targets";

/**
 * Tier-1 integration test: drive the real materialize-version pipeline against
 * fixtures shaped like the Echo Park Paper app (a bare RN project with a
 * NotificationService app-extension and a react-native-config build.gradle),
 * with the eas.json version (18 / 6.0.5) DELIBERATELY different from the value
 * baked into the native files (16 / 6.0.4). Anything still reading 16 / 6.0.4
 * after the run means the override never reached the binary inputs.
 *
 * It exercises the exact production code path short of invoking xcodebuild /
 * gradle: discoverSignedTargets → buildSigningEntries → applyTargetSigning for
 * iOS, and applyAndroidVersion for Android.
 */

const testLayer = Layer.mergeAll(NodeFileSystem.layer, makeOutputModeLayer(false));

// ── iOS fixture: app `Jmango360` + extension `NotificationService`, Debug+Release ──
const EPP_PBXPROJ = `// !$*UTF8*$!
{
\tarchiveVersion = 1;
\tclasses = {
\t};
\tobjectVersion = 56;
\tobjects = {

/* Begin PBXNativeTarget section */
\t\tA001 /* Jmango360 */ = {
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = B001;
\t\t\tbuildPhases = ();
\t\t\tname = Jmango360;
\t\t\tproductName = Jmango360;
\t\t\tproductReference = C001;
\t\t\tproductType = "com.apple.product-type.application";
\t\t};
\t\tA002 /* NotificationService */ = {
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = B002;
\t\t\tbuildPhases = ();
\t\t\tname = NotificationService;
\t\t\tproductName = NotificationService;
\t\t\tproductReference = C002;
\t\t\tproductType = "com.apple.product-type.app-extension";
\t\t};
/* End PBXNativeTarget section */

/* Begin XCConfigurationList section */
\t\tB001 = {
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\tD001 /* Debug */,
\t\t\t\tD002 /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationName = Release;
\t\t};
\t\tB002 = {
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\tD003 /* Debug */,
\t\t\t\tD004 /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationName = Release;
\t\t};
/* End XCConfigurationList section */

/* Begin XCBuildConfiguration section */
\t\tD001 /* Debug */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.echoparkpaper;
\t\t\t\tMARKETING_VERSION = 6.0.4;
\t\t\t\tCURRENT_PROJECT_VERSION = 16;
\t\t\t};
\t\t\tname = Debug;
\t\t};
\t\tD002 /* Release */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.echoparkpaper;
\t\t\t\tMARKETING_VERSION = 6.0.4;
\t\t\t\tCURRENT_PROJECT_VERSION = 16;
\t\t\t};
\t\t\tname = Release;
\t\t};
\t\tD003 /* Debug */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.echoparkpaper.NotificationService;
\t\t\t\tMARKETING_VERSION = 6.0.4;
\t\t\t\tCURRENT_PROJECT_VERSION = 16;
\t\t\t};
\t\t\tname = Debug;
\t\t};
\t\tD004 /* Release */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.echoparkpaper.NotificationService;
\t\t\t\tMARKETING_VERSION = 6.0.4;
\t\t\t\tCURRENT_PROJECT_VERSION = 16;
\t\t\t};
\t\t\tname = Release;
\t\t};
/* End XCBuildConfiguration section */
\t};
\trootObject = R001;
}
`;

const EPP_GRADLE = `android {
    defaultConfig {
        applicationId project.env.get("APP_ID")
        versionCode project.env.get("VERSION_CODE_APP").toInteger()
        versionName project.env.get("VERSION_NAME_APP")
    }
}
`;

const count = (haystack: string, needle: RegExp): number => (haystack.match(needle) ?? []).length;

const setupIos = (pbxproj: string) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "epp-ios-")));
  const iosDir = path.join(root, "ios");
  mkdirSync(path.join(iosDir, "Jmango360.xcodeproj"), { recursive: true });
  const pbxprojPath = path.join(iosDir, "Jmango360.xcodeproj", "project.pbxproj");
  writeFileSync(pbxprojPath, pbxproj);
  return { iosDir, pbxprojPath, dispose: () => rmSync(root, { recursive: true, force: true }) };
};

const RNC_PKG = JSON.stringify({
  name: "echo-park-paper",
  dependencies: { "react-native": "0.77.0", "react-native-config": "1.5.5" },
});

const setupAndroid = (gradle: string, env: string, packageJson?: string) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "epp-android-")));
  mkdirSync(path.join(root, "android", "app"), { recursive: true });
  const gradlePath = path.join(root, "android", "app", "build.gradle");
  const envPath = path.join(root, ".env");
  writeFileSync(gradlePath, gradle);
  writeFileSync(envPath, env);
  if (packageJson !== undefined) {
    writeFileSync(path.join(root, "package.json"), packageJson);
  }
  return {
    root,
    gradlePath,
    envPath,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
};

describe("materialize eas.json version (EPP shape)", () => {
  it.effect("iOS: version 18/6.0.5 lands on app AND extension Release, Debug untouched", () =>
    Effect.gen(function* () {
      const project = setupIos(EPP_PBXPROJ);
      try {
        // 1. Real target discovery: app + extension, scoped to Release.
        const signedTargets = yield* discoverSignedTargets({
          iosDir: project.iosDir,
          configurationName: "Release",
        });
        expect(signedTargets.map((target) => target.targetName).toSorted()).toStrictEqual([
          "Jmango360",
          "NotificationService",
        ]);

        // 2. Real entry builder (production policy: version on every signed target).
        const entries = buildSigningEntries({
          installedTargets: signedTargets.map((target) => ({
            target,
            installed: { teamId: "ABC1234567", name: `${target.targetName} APP_STORE 1` },
          })),
          signingIdentity: "Apple Distribution",
          nativeVersion: { marketingVersion: "6.0.5", currentProjectVersion: "18" },
        });

        // 3. Real pbxproj mutation.
        yield* applyTargetSigning({ iosDir: project.iosDir, entries });

        const written = readFileSync(project.pbxprojPath, "utf8");

        // Both Release configs (app D002 + extension D004) bumped to the eas.json value.
        expect(count(written, /MARKETING_VERSION = 6\.0\.5;/gu)).toBe(2);
        expect(count(written, /CURRENT_PROJECT_VERSION = 18;/gu)).toBe(2);
        // Debug configs are scoped out (archive uses Release) — still the old value.
        expect(count(written, /MARKETING_VERSION = 6\.0\.4;/gu)).toBe(2);
        expect(count(written, /CURRENT_PROJECT_VERSION = 16;/gu)).toBe(2);
        // Signing applied to both Release targets.
        expect(count(written, /CODE_SIGN_STYLE = Manual;/gu)).toBe(2);

        // File still parses to the same two signed targets (not corrupted).
        const reparsed = yield* discoverSignedTargets({
          iosDir: project.iosDir,
          configurationName: "Release",
        });
        expect(reparsed).toHaveLength(2);
      } finally {
        project.dispose();
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("Android react-native-config: version 18/6.0.5 lands in .env, gradle untouched", () =>
    Effect.gen(function* () {
      const project = setupAndroid(
        EPP_GRADLE,
        "APP_ID=com.echoparkpaper\nVERSION_CODE_APP=16\nVERSION_NAME_APP=6.0.4\n",
      );
      try {
        yield* applyAndroidVersion({
          projectRoot: project.root,
          versionName: "6.0.5",
          versionCode: "18",
        });
        const env = readFileSync(project.envPath, "utf8");
        expect(env).toContain("VERSION_CODE_APP=18");
        expect(env).toContain("VERSION_NAME_APP=6.0.5");
        expect(env).not.toContain("VERSION_CODE_APP=16");
        expect(env).not.toContain("VERSION_NAME_APP=6.0.4");
        // Unrelated config preserved; the dynamic gradle is not rewritten.
        expect(env).toContain("APP_ID=com.echoparkpaper");
        expect(readFileSync(project.gradlePath, "utf8")).toBe(EPP_GRADLE);
      } finally {
        project.dispose();
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "Gap B + version order: server env is materialized, then eas.json wins on version",
    () =>
      Effect.gen(function* () {
        // The server env-vault carries the OLD version (10 / 6.0.3); eas.json says
        // 18 / 6.0.5. The build runs materializeEnvFile first, then applyAndroidVersion
        // (mirrors runPlatformBuild → runAndroidBuild). The override must win.
        const project = setupAndroid(EPP_GRADLE, "", RNC_PKG);
        try {
          yield* materializeEnvFile({
            projectRoot: project.root,
            envVars: {
              APP_ID: "com.echoparkpaper",
              API_ENDPOINT: "https://api.echoparkpaper.com",
              VERSION_CODE_APP: "10",
              VERSION_NAME_APP: "6.0.3",
            },
          });
          yield* applyAndroidVersion({
            projectRoot: project.root,
            versionName: "6.0.5",
            versionCode: "18",
          });
          const env = readFileSync(project.envPath, "utf8");
          // Non-version server config materialized verbatim.
          expect(env).toContain("APP_ID=com.echoparkpaper");
          expect(env).toContain("API_ENDPOINT=https://api.echoparkpaper.com");
          // eas.json overrides the server's version, no stale value left behind.
          expect(env).toContain("VERSION_CODE_APP=18");
          expect(env).toContain("VERSION_NAME_APP=6.0.5");
          expect(env).not.toContain("VERSION_CODE_APP=10");
          expect(env).not.toContain("VERSION_NAME_APP=6.0.3");
        } finally {
          project.dispose();
        }
      }).pipe(Effect.provide(testLayer)),
  );
});
