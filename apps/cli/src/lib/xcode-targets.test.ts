import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { XcodeProjectError } from "./exit-codes";
import { failureError } from "./test-utils";
import { discoverSignedTargets } from "./xcode-targets";

const setupProject = (
  pbxproj: string,
): { readonly iosDir: string; readonly dispose: () => void } => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "xcode-targets-")));
  const iosDir = path.join(root, "ios");
  mkdirSync(path.join(iosDir, "MyApp.xcodeproj"), { recursive: true });
  writeFileSync(path.join(iosDir, "MyApp.xcodeproj", "project.pbxproj"), pbxproj);
  return { iosDir, dispose: () => rmSync(root, { recursive: true, force: true }) };
};

const minimalPbxproj = `// !$*UTF8*$!
{
\tarchiveVersion = 1;
\tclasses = {
\t};
\tobjectVersion = 56;
\tobjects = {

/* Begin PBXNativeTarget section */
\t\tA001 /* MyApp */ = {
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = B001;
\t\t\tbuildPhases = ();
\t\t\tbuildRules = ();
\t\t\tdependencies = ();
\t\t\tname = MyApp;
\t\t\tproductName = MyApp;
\t\t\tproductReference = C001;
\t\t\tproductType = "com.apple.product-type.application";
\t\t};
\t\tA002 /* NotificationService */ = {
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = B002;
\t\t\tbuildPhases = ();
\t\t\tbuildRules = ();
\t\t\tdependencies = ();
\t\t\tname = NotificationService;
\t\t\tproductName = NotificationService;
\t\t\tproductReference = C002;
\t\t\tproductType = "com.apple.product-type.app-extension";
\t\t};
\t\tA003 /* SomeLib */ = {
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = B003;
\t\t\tbuildPhases = ();
\t\t\tbuildRules = ();
\t\t\tdependencies = ();
\t\t\tname = SomeLib;
\t\t\tproductName = SomeLib;
\t\t\tproductReference = C003;
\t\t\tproductType = "com.apple.product-type.library.static";
\t\t};
/* End PBXNativeTarget section */

/* Begin XCConfigurationList section */
\t\tB001 /* List for MyApp */ = {
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\tD001 /* Debug */,
\t\t\t\tD002 /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t};
\t\tB002 /* List for NotificationService */ = {
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\tD003 /* Debug */,
\t\t\t\tD004 /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t};
\t\tB003 /* List for SomeLib */ = {
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\tD005 /* Debug */,
\t\t\t\tD006 /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t};
/* End XCConfigurationList section */

/* Begin XCBuildConfiguration section */
\t\tD001 /* Debug */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = "com.example.app.debug";
\t\t\t};
\t\t\tname = Debug;
\t\t};
\t\tD002 /* Release */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = "com.example.app";
\t\t\t};
\t\t\tname = Release;
\t\t};
\t\tD003 /* Debug */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = "com.example.app.notification.debug";
\t\t\t};
\t\t\tname = Debug;
\t\t};
\t\tD004 /* Release */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = "com.example.app.notification";
\t\t\t};
\t\t\tname = Release;
\t\t};
\t\tD005 /* Debug */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t};
\t\t\tname = Debug;
\t\t};
\t\tD006 /* Release */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t};
\t\t\tname = Release;
\t\t};
/* End XCBuildConfiguration section */
\t};
\trootObject = R001;
}
`;

describe(discoverSignedTargets, () => {
  it.effect("returns app + extension targets for Release, skipping the static library", () =>
    Effect.gen(function* () {
      const project = setupProject(minimalPbxproj);
      try {
        const targets = yield* discoverSignedTargets({
          iosDir: project.iosDir,
          configurationName: "Release",
        });

        expect(targets).toHaveLength(2);
        const byName = new Map(targets.map((target) => [target.targetName, target]));

        const app = byName.get("MyApp");
        expect(app?.bundleId).toBe("com.example.app");
        expect(app?.productType).toBe("com.apple.product-type.application");
        expect(app?.buildConfigurationUuids).toStrictEqual(["D002"]);

        const ext = byName.get("NotificationService");
        expect(ext?.bundleId).toBe("com.example.app.notification");
        expect(ext?.productType).toBe("com.apple.product-type.app-extension");
        expect(ext?.buildConfigurationUuids).toStrictEqual(["D004"]);
      } finally {
        project.dispose();
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("returns per-configuration bundle IDs for Debug", () =>
    Effect.gen(function* () {
      const project = setupProject(minimalPbxproj);
      try {
        const targets = yield* discoverSignedTargets({
          iosDir: project.iosDir,
          configurationName: "Debug",
        });
        const byName = new Map(targets.map((target) => [target.targetName, target]));
        expect(byName.get("MyApp")?.bundleId).toBe("com.example.app.debug");
        expect(byName.get("NotificationService")?.bundleId).toBe(
          "com.example.app.notification.debug",
        );
      } finally {
        project.dispose();
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("fails with XcodeProjectError when iosDir has no .xcodeproj", () =>
    Effect.gen(function* () {
      const root = realpathSync(mkdtempSync(path.join(tmpdir(), "xcode-targets-empty-")));
      const iosDir = path.join(root, "ios");
      mkdirSync(iosDir, { recursive: true });
      try {
        const exit = yield* Effect.exit(
          discoverSignedTargets({ iosDir, configurationName: "Release" }),
        );
        const err = failureError(exit);
        expect(err).toBeInstanceOf(XcodeProjectError);
        expect(err?.message).toContain("No .xcodeproj");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("fails with XcodeProjectError when configuration name is missing", () =>
    Effect.gen(function* () {
      const project = setupProject(minimalPbxproj);
      try {
        const exit = yield* Effect.exit(
          discoverSignedTargets({ iosDir: project.iosDir, configurationName: "Staging" }),
        );
        const err = failureError(exit);
        expect(err).toBeInstanceOf(XcodeProjectError);
        expect(err?.message).toContain("Staging");
      } finally {
        project.dispose();
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
