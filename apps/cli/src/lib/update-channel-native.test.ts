import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { isRecord } from "@better-update/type-guards";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { makeOutputModeLayer } from "./output-mode";
import { buildPlistXml, parsePlistXml } from "./plist";
import {
  isExpoUpdatesInstalled,
  setAndroidUpdateChannel,
  setIosUpdateChannel,
  withChannelHeader,
} from "./update-channel-native";

const TestLayer = Layer.mergeAll(NodeServices.layer, makeOutputModeLayer(false));

const makeDir = (): { readonly dir: string; readonly dispose: () => void } => {
  const dir = mkdtempSync(nodePath.join(tmpdir(), "bu-update-channel-"));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
};

const ANDROID_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:name=".MainApplication" android:label="@string/app_name">
    <meta-data android:name="expo.modules.updates.EXPO_UPDATE_URL" android:value="https://example.com/manifest/p1"/>
  </application>
</manifest>
`;

const ANDROID_MANIFEST_WITH_HEADERS = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:name=".MainApplication">
    <meta-data android:name="expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY" android:value="{&quot;x-custom&quot;:&quot;kept&quot;,&quot;expo-channel-name&quot;:&quot;old&quot;}"/>
  </application>
</manifest>
`;

const writeAndroidManifest = (dir: string, content: string): string => {
  const manifestDir = nodePath.join(dir, "android", "app", "src", "main");
  mkdirSync(manifestDir, { recursive: true });
  const manifestPath = nodePath.join(manifestDir, "AndroidManifest.xml");
  writeFileSync(manifestPath, content);
  return manifestPath;
};

const IOS_EXPO_PLIST = buildPlistXml({
  EXUpdatesURL: "https://example.com/manifest/p1",
  EXUpdatesRequestHeaders: { "x-custom": "kept" },
});

const writeExpoPlist = (dir: string, content: string): string => {
  const supportingDir = nodePath.join(dir, "ios", "MyApp", "Supporting");
  mkdirSync(supportingDir, { recursive: true });
  const plistPath = nodePath.join(supportingDir, "Expo.plist");
  writeFileSync(plistPath, content);
  return plistPath;
};

describe(withChannelHeader, () => {
  it("creates the header map from nothing", () => {
    expect(withChannelHeader(undefined, "production")).toStrictEqual({
      "expo-channel-name": "production",
    });
  });

  it("preserves other headers and overwrites a stale channel", () => {
    expect(
      withChannelHeader({ "x-custom": "kept", "expo-channel-name": "old" }, "preview"),
    ).toStrictEqual({ "x-custom": "kept", "expo-channel-name": "preview" });
  });
});

describe(isExpoUpdatesInstalled, () => {
  it.effect("detects expo-updates in dependencies", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      writeFileSync(
        nodePath.join(dir, "package.json"),
        JSON.stringify({ dependencies: { "expo-updates": "~29.0.0" } }),
      );
      const installed = yield* isExpoUpdatesInstalled(dir).pipe(
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(installed).toBe(true);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("returns false without the dependency or without a package.json", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      const missingFile = yield* isExpoUpdatesInstalled(dir);
      writeFileSync(
        nodePath.join(dir, "package.json"),
        JSON.stringify({ dependencies: { expo: "~56.0.0" } }),
      );
      const missingDep = yield* isExpoUpdatesInstalled(dir).pipe(
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(missingFile).toBe(false);
      expect(missingDep).toBe(false);
    }).pipe(Effect.provide(TestLayer)),
  );
});

describe(setAndroidUpdateChannel, () => {
  it.effect("adds the request-headers meta-data entry with the channel", () => {
    const { dir, dispose } = makeDir();
    return Effect.gen(function* () {
      const manifestPath = writeAndroidManifest(dir, ANDROID_MANIFEST);
      yield* setAndroidUpdateChannel({ projectRoot: dir, channel: "production" });
      const written = readFileSync(manifestPath, "utf8");
      expect(written).toContain("expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY");
      expect(written).toContain("expo-channel-name");
      expect(written).toContain("production");
    }).pipe(Effect.ensuring(Effect.sync(dispose)), Effect.provide(TestLayer));
  });

  it.effect("merges with existing headers instead of clobbering them", () => {
    const { dir, dispose } = makeDir();
    return Effect.gen(function* () {
      const manifestPath = writeAndroidManifest(dir, ANDROID_MANIFEST_WITH_HEADERS);
      yield* setAndroidUpdateChannel({ projectRoot: dir, channel: "preview" });
      const written = readFileSync(manifestPath, "utf8");
      expect(written).toContain("x-custom");
      expect(written).toContain("kept");
      expect(written).toContain("preview");
      expect(written).not.toContain("old");
    }).pipe(Effect.ensuring(Effect.sync(dispose)), Effect.provide(TestLayer));
  });

  // Injection now runs on committed trees, not just on what prebuild emitted,
  // so a Kotlin-Multiplatform layout is a legitimate target too. The
  // `@expo/config-plugins` helper cannot find this one — it hard-codes
  // `android/app/src/main/`.
  it.effect("finds a Kotlin-Multiplatform manifest outside android/app/src/main", () => {
    const { dir, dispose } = makeDir();
    return Effect.gen(function* () {
      const manifestDir = nodePath.join(dir, "composeApp", "src", "androidMain");
      mkdirSync(manifestDir, { recursive: true });
      const manifestPath = nodePath.join(manifestDir, "AndroidManifest.xml");
      writeFileSync(manifestPath, ANDROID_MANIFEST);
      yield* setAndroidUpdateChannel({ projectRoot: dir, channel: "production" });
      expect(readFileSync(manifestPath, "utf8")).toContain("expo-channel-name");
    }).pipe(Effect.ensuring(Effect.sync(dispose)), Effect.provide(TestLayer));
  });

  // The profile's Gradle module is the one that ships. Writing into a stale
  // `app` module would leave the released AAB with no channel header at all,
  // and nothing in the build log would say so.
  it.effect("prefers the profile's Gradle module over a stale app module", () => {
    const { dir, dispose } = makeDir();
    return Effect.gen(function* () {
      const stalePath = writeAndroidManifest(dir, ANDROID_MANIFEST);
      const moduleDir = nodePath.join(dir, "android", "mobile", "src", "main");
      mkdirSync(moduleDir, { recursive: true });
      const modulePath = nodePath.join(moduleDir, "AndroidManifest.xml");
      writeFileSync(modulePath, ANDROID_MANIFEST);
      yield* setAndroidUpdateChannel({ projectRoot: dir, channel: "production", module: "mobile" });
      expect(readFileSync(modulePath, "utf8")).toContain("expo-channel-name");
      expect(readFileSync(stalePath, "utf8")).not.toContain("expo-channel-name");
    }).pipe(Effect.ensuring(Effect.sync(dispose)), Effect.provide(TestLayer));
  });

  // Injection runs on trees whose layout this code cannot know (committed,
  // custom, sub-project). A target it cannot reach means "not injectable here",
  // not "misconfigured" — failing would redden builds that were green before,
  // with nothing the user could change. Warning already ends the silence that
  // was the actual bug.
  it.effect("warns instead of failing when no Android manifest is reachable", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      mkdirSync(nodePath.join(dir, "android"), { recursive: true });
      const result = yield* setAndroidUpdateChannel({ projectRoot: dir, channel: "x" }).pipe(
        Effect.result,
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(result._tag).toBe("Success");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("warns instead of failing when no android project exists", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      const result = yield* setAndroidUpdateChannel({ projectRoot: dir, channel: "x" }).pipe(
        Effect.result,
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(result._tag).toBe("Success");
    }).pipe(Effect.provide(TestLayer)),
  );
});

describe(setIosUpdateChannel, () => {
  it.effect("merges the channel into EXUpdatesRequestHeaders in Expo.plist", () => {
    const { dir, dispose } = makeDir();
    return Effect.gen(function* () {
      const plistPath = writeExpoPlist(dir, IOS_EXPO_PLIST);
      yield* setIosUpdateChannel({
        iosDir: nodePath.join(dir, "ios"),
        channel: "production",
      });
      // @expo/plist objects carry a non-Object prototype, so spread into
      // plain objects before strict comparison.
      const parsed: unknown = parsePlistXml(readFileSync(plistPath, "utf8"));
      const root = isRecord(parsed) ? parsed : {};
      const headers = isRecord(root["EXUpdatesRequestHeaders"])
        ? root["EXUpdatesRequestHeaders"]
        : {};
      expect({ ...headers }).toStrictEqual({
        "x-custom": "kept",
        "expo-channel-name": "production",
      });
      expect(root["EXUpdatesURL"]).toBe("https://example.com/manifest/p1");
    }).pipe(Effect.ensuring(Effect.sync(dispose)), Effect.provide(TestLayer));
  });

  // Committed iOS projects often keep Expo.plist directly under the target
  // group, without the `Supporting/` folder prebuild generates.
  it.effect("finds an Expo.plist kept directly under the target group", () => {
    const { dir, dispose } = makeDir();
    return Effect.gen(function* () {
      const targetDir = nodePath.join(dir, "ios", "MyApp");
      mkdirSync(targetDir, { recursive: true });
      const plistPath = nodePath.join(targetDir, "Expo.plist");
      writeFileSync(plistPath, IOS_EXPO_PLIST);
      yield* setIosUpdateChannel({ iosDir: nodePath.join(dir, "ios"), channel: "preview" });
      const parsed: unknown = parsePlistXml(readFileSync(plistPath, "utf8"));
      const root = isRecord(parsed) ? parsed : {};
      const headers = isRecord(root["EXUpdatesRequestHeaders"])
        ? root["EXUpdatesRequestHeaders"]
        : {};
      expect({ ...headers }).toStrictEqual({
        "x-custom": "kept",
        "expo-channel-name": "preview",
      });
    }).pipe(Effect.ensuring(Effect.sync(dispose)), Effect.provide(TestLayer));
  });

  // Directory order is alphabetical, so a per-directory search would hand
  // `AppClip/Expo.plist` the channel and leave the app that actually ships
  // without one. The prebuild layout has to win across ALL targets first.
  it.effect("prefers the prebuild layout over an earlier target's bare plist", () => {
    const { dir, dispose } = makeDir();
    return Effect.gen(function* () {
      const clipDir = nodePath.join(dir, "ios", "AppClip");
      mkdirSync(clipDir, { recursive: true });
      const clipPlist = nodePath.join(clipDir, "Expo.plist");
      writeFileSync(clipPlist, IOS_EXPO_PLIST);
      const mainPlist = writeExpoPlist(dir, IOS_EXPO_PLIST);
      yield* setIosUpdateChannel({ iosDir: nodePath.join(dir, "ios"), channel: "production" });
      expect(readFileSync(mainPlist, "utf8")).toContain("expo-channel-name");
      expect(readFileSync(clipPlist, "utf8")).not.toContain("expo-channel-name");
    }).pipe(Effect.ensuring(Effect.sync(dispose)), Effect.provide(TestLayer));
  });

  it.effect("warns instead of failing when no Expo.plist exists under ios/", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      mkdirSync(nodePath.join(dir, "ios"), { recursive: true });
      const result = yield* setIosUpdateChannel({
        iosDir: nodePath.join(dir, "ios"),
        channel: "production",
      }).pipe(Effect.result, Effect.ensuring(Effect.sync(dispose)));
      expect(result._tag).toBe("Success");
    }).pipe(Effect.provide(TestLayer)),
  );
});
