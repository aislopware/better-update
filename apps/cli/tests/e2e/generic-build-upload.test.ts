import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { setupCliE2E } from "../helpers/cli-e2e";

// A bare (non-Expo) React Native project: committed `android/` + `ios/` native
// dirs, no app.json. The CLI must detect `projectType: "bare"`, read build
// metadata from the native files (build.gradle / project.pbxproj) — never Expo —
// and upload the prebuilt artifact through the full server + R2 round-trip with
// NO OTA fields (runtimeVersion omitted; server `runtimeVersion` is nullable).
const cli = setupCliE2E("e2e-cli-generic-build-upload", {
  noExpoConfig: true,
  appJsonTemplate: { expo: { name: "Bare Build App", slug: "bare-build-app" } },
  userEmail: "cli-e2e-generic-build-upload@example.com",
  orgSlug: "cli-e2e-generic-build-upload-org",
});

// ── Native-file fixtures (drive resolve-app-meta without a real toolchain) ──

const APPLICATION_ID = "com.example.bareapp";
const ANDROID_VERSION_NAME = "2.3.0";
const ANDROID_VERSION_CODE = 7;

const IOS_BUNDLE_ID = "com.example.bareapp";
const IOS_MARKETING_VERSION = "4.1.0";
const IOS_CURRENT_PROJECT_VERSION = 12;

const buildGradle = `android {
    namespace "${APPLICATION_ID}"
    defaultConfig {
        applicationId "${APPLICATION_ID}"
        versionCode ${ANDROID_VERSION_CODE}
        versionName "${ANDROID_VERSION_NAME}"
    }
}
`;

const pbxproj = `// !$*UTF8*$!
{
\tarchiveVersion = 1;
\tclasses = {
\t};
\tobjectVersion = 56;
\tobjects = {

/* Begin PBXNativeTarget section */
\t\tA001 /* BareApp */ = {
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = B001;
\t\t\tname = BareApp;
\t\t\tproductType = "com.apple.product-type.application";
\t\t};
/* End PBXNativeTarget section */

/* Begin XCConfigurationList section */
\t\tB001 /* List for BareApp */ = {
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\tD002 /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationName = Release;
\t\t};
/* End XCConfigurationList section */

/* Begin XCBuildConfiguration section */
\t\tD002 /* Release */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = "${IOS_BUNDLE_ID}";
\t\t\t\tMARKETING_VERSION = ${IOS_MARKETING_VERSION};
\t\t\t\tCURRENT_PROJECT_VERSION = ${IOS_CURRENT_PROJECT_VERSION};
\t\t\t};
\t\t\tname = Release;
\t\t};
/* End XCBuildConfiguration section */
\t};
\trootObject = R001;
}
`;

const APK_NAME = "app-release.apk";
const IPA_NAME = "BareApp.ipa";

// ── Server-side build record (shape of GET /api/builds rows) ─────────

interface BuildRow {
  readonly id: string;
  readonly platform: string;
  readonly profile: string;
  readonly runtimeVersion: string | null;
  readonly appVersion: string | null;
  readonly buildNumber: string | null;
  readonly bundleId: string | null;
}

const fetchBuildsByPlatform = async (platform: string): Promise<readonly BuildRow[]> => {
  const response = await cli.getAuthorized(
    `/api/builds?projectId=${cli.getProjectId()}&platform=${platform}`,
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: readonly BuildRow[] };
  return body.items;
};

beforeAll(() => {
  const root = cli.getProjectDir();

  // Mark it a JS project so auto-detection lands on `bare`; the explicit
  // `projectType` override in eas.json pins it regardless.
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "bare-build-app", version: "1.0.0" }, null, 2)}\n`,
  );

  writeFileSync(
    path.join(root, "eas.json"),
    `${JSON.stringify(
      {
        projectId: cli.getProjectId(),
        projectType: "bare",
        build: {
          production: {
            environment: "production",
            android: { distribution: "direct", format: "apk" },
            ios: { distribution: "ad-hoc" },
          },
        },
      },
      null,
      2,
    )}\n`,
  );

  mkdirSync(path.join(root, "android", "app"), { recursive: true });
  writeFileSync(path.join(root, "android", "app", "build.gradle"), buildGradle);

  mkdirSync(path.join(root, "ios", "BareApp.xcodeproj"), { recursive: true });
  writeFileSync(path.join(root, "ios", "BareApp.xcodeproj", "project.pbxproj"), pbxproj);

  // Prebuilt artifacts to upload (content is irrelevant — only hashed + stored).
  writeFileSync(path.join(root, APK_NAME), Buffer.from("dummy-apk-bytes"));
  writeFileSync(path.join(root, IPA_NAME), Buffer.from("dummy-ipa-bytes"));
});

describe("generic build upload: bare RN project (no Expo, no OTA)", () => {
  it("doctor reports the bare project type from the eas.json override", () => {
    const result = cli.runCli("doctor");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("bare (eas.json override)");
    expect(result.stdout).toContain("1 profile(s) defined");
  });

  it("uploads an APK reading metadata from build.gradle, omitting OTA fields", async () => {
    const result = cli.runCli("builds", "upload", APK_NAME, "--platform", "android");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Build ID");
    // Non-Expo build → no eas-updates → no runtime version printed.
    expect(result.stdout).not.toContain("Runtime version");

    const builds = await fetchBuildsByPlatform("android");
    expect(builds.length).toBeGreaterThanOrEqual(1);
    const build = builds[0]!;
    expect(build.profile).toBe("production");
    expect(build.bundleId).toBe(APPLICATION_ID);
    expect(build.appVersion).toBe(ANDROID_VERSION_NAME);
    expect(build.buildNumber).toBe(String(ANDROID_VERSION_CODE));
    // The crux: a non-Expo build carries no OTA runtime version server-side.
    expect(build.runtimeVersion).toBeNull();
  });

  it("uploads an IPA reading metadata from project.pbxproj, omitting OTA fields", async () => {
    const result = cli.runCli("builds", "upload", IPA_NAME, "--platform", "ios");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Build ID");
    expect(result.stdout).not.toContain("Runtime version");

    // The harness seeds one ios build at setup; find the one we just uploaded.
    const builds = await fetchBuildsByPlatform("ios");
    const build = builds.find((row) => row.bundleId === IOS_BUNDLE_ID);
    expect(build).toBeDefined();
    expect(build!.profile).toBe("production");
    expect(build!.appVersion).toBe(IOS_MARKETING_VERSION);
    expect(build!.buildNumber).toBe(String(IOS_CURRENT_PROJECT_VERSION));
    expect(build!.runtimeVersion).toBeNull();
  });
});
