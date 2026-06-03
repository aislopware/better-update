import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { readIosNativeMeta } from "./ios-native-meta";

const setupProject = (
  pbxproj: string,
): { readonly iosDir: string; readonly dispose: () => void } => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ios-native-meta-")));
  const iosDir = path.join(root, "ios");
  mkdirSync(path.join(iosDir, "MyApp.xcodeproj"), { recursive: true });
  writeFileSync(path.join(iosDir, "MyApp.xcodeproj", "project.pbxproj"), pbxproj);
  return { iosDir, dispose: () => rmSync(root, { recursive: true, force: true }) };
};

const pbxproj = (releaseSettings: string): string => `// !$*UTF8*$!
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
\t\t\tname = MyApp;
\t\t\tproductType = "com.apple.product-type.application";
\t\t};
/* End PBXNativeTarget section */

/* Begin XCConfigurationList section */
\t\tB001 /* List for MyApp */ = {
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\tD001 /* Debug */,
\t\t\t\tD002 /* Release */,
\t\t\t);
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
${releaseSettings}
\t\t\t};
\t\t\tname = Release;
\t\t};
/* End XCBuildConfiguration section */
\t};
\trootObject = R001;
}
`;

describe(readIosNativeMeta, () => {
  it.effect("reads bundle id, marketing version and build number for the app target", () =>
    Effect.gen(function* () {
      const project = setupProject(
        pbxproj(
          '\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = "com.example.app";\n' +
            "\t\t\t\tMARKETING_VERSION = 1.4.2;\n" +
            "\t\t\t\tCURRENT_PROJECT_VERSION = 88;",
        ),
      );
      const meta = yield* readIosNativeMeta({
        iosDir: project.iosDir,
        configurationName: "Release",
      }).pipe(Effect.ensuring(Effect.sync(project.dispose)));
      expect(meta.bundleId).toBe("com.example.app");
      expect(meta.marketingVersion).toBe("1.4.2");
      expect(meta.currentProjectVersion).toBe("88");
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("treats unresolved build-setting references as absent", () =>
    Effect.gen(function* () {
      const project = setupProject(
        pbxproj(
          '\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = "com.example.app";\n' +
            '\t\t\t\tMARKETING_VERSION = "$(MARKETING_VERSION)";',
        ),
      );
      const meta = yield* readIosNativeMeta({
        iosDir: project.iosDir,
        configurationName: "Release",
      }).pipe(Effect.ensuring(Effect.sync(project.dispose)));
      expect(meta.bundleId).toBe("com.example.app");
      expect(meta.marketingVersion).toBeUndefined();
      expect(meta.currentProjectVersion).toBeUndefined();
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
