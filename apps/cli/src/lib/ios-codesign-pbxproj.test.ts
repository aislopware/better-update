import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { applyTargetSigning } from "./ios-codesign-pbxproj";

const setupProject = (
  pbxproj: string,
): { readonly iosDir: string; readonly pbxprojPath: string; readonly dispose: () => void } => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codesign-pbxproj-")));
  const iosDir = join(root, "ios");
  const projectDir = join(iosDir, "MyApp.xcodeproj");
  mkdirSync(projectDir, { recursive: true });
  const pbxprojPath = join(projectDir, "project.pbxproj");
  writeFileSync(pbxprojPath, pbxproj);
  return { iosDir, pbxprojPath, dispose: () => rmSync(root, { recursive: true, force: true }) };
};

const pbxprojWithExtension = `// !$*UTF8*$!
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
/* End PBXNativeTarget section */

/* Begin XCConfigurationList section */
\t\tB001 = {
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\tD002 /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t};
\t\tB002 = {
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\tD004 /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t};
/* End XCConfigurationList section */

/* Begin XCBuildConfiguration section */
\t\tD002 /* Release */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = "com.example.app";
\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t\tPROVISIONING_PROFILE = "00000000-0000-0000-0000-000000000000";
\t\t\t\t"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Development";
\t\t\t};
\t\t\tname = Release;
\t\t};
\t\tD004 /* Release */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = "com.example.app.notification";
\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t};
\t\t\tname = Release;
\t\t};
/* End XCBuildConfiguration section */
\t};
\trootObject = R001;
}
`;

describe(applyTargetSigning, () => {
  it.effect("writes per-target Manual signing into Release configs and clears legacy keys", () =>
    Effect.gen(function* () {
      const project = setupProject(pbxprojWithExtension);
      try {
        yield* applyTargetSigning({
          iosDir: project.iosDir,
          entries: [
            {
              targetName: "MyApp",
              buildConfigurationUuids: ["D002"],
              settings: {
                teamId: "ABC1234567",
                signingIdentity: "Apple Distribution",
                profileSpecifier: "MyApp APP_STORE 12345",
              },
            },
            {
              targetName: "NotificationService",
              buildConfigurationUuids: ["D004"],
              settings: {
                teamId: "ABC1234567",
                signingIdentity: "Apple Distribution",
                profileSpecifier: "NotificationService APP_STORE 67890",
              },
            },
          ],
        });

        const written = readFileSync(project.pbxprojPath, "utf8");

        // App target — Release config: Manual signing + profile, legacy + SDK-conditional cleared.
        expect(written).toMatch(/D002 \/\* Release \*\/ = \{[\s\S]*?CODE_SIGN_STYLE = Manual;/u);
        expect(written).toContain(`DEVELOPMENT_TEAM = "ABC1234567";`);
        expect(written).toContain(`PROVISIONING_PROFILE_SPECIFIER = "MyApp APP_STORE 12345";`);
        expect(written).not.toContain("PROVISIONING_PROFILE =");
        expect(written).not.toContain("CODE_SIGN_IDENTITY[sdk=iphoneos*]");

        // Extension target — Release config: its own profile specifier.
        expect(written).toContain(
          `PROVISIONING_PROFILE_SPECIFIER = "NotificationService APP_STORE 67890";`,
        );
      } finally {
        project.dispose();
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("is idempotent — running twice produces the same file contents", () =>
    Effect.gen(function* () {
      const project = setupProject(pbxprojWithExtension);
      try {
        const entries = [
          {
            targetName: "MyApp",
            buildConfigurationUuids: ["D002"],
            settings: {
              teamId: "ABC1234567",
              signingIdentity: "Apple Distribution",
              profileSpecifier: "MyApp APP_STORE 12345",
            },
          },
        ] as const;

        yield* applyTargetSigning({ iosDir: project.iosDir, entries });
        const first = readFileSync(project.pbxprojPath, "utf8");
        yield* applyTargetSigning({ iosDir: project.iosDir, entries });
        const second = readFileSync(project.pbxprojPath, "utf8");

        expect(second).toBe(first);
      } finally {
        project.dispose();
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
