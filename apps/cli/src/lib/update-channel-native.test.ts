import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { isRecord } from "@better-update/type-guards";
import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { buildPlistXml, parsePlistXml } from "./plist";
import {
  isExpoUpdatesInstalled,
  setAndroidUpdateChannel,
  setIosUpdateChannel,
  withChannelHeader,
} from "./update-channel-native";

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
    }).pipe(Effect.provide(NodeContext.layer)),
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
    }).pipe(Effect.provide(NodeContext.layer)),
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
    }).pipe(Effect.ensuring(Effect.sync(dispose)), Effect.provide(NodeContext.layer));
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
    }).pipe(Effect.ensuring(Effect.sync(dispose)), Effect.provide(NodeContext.layer));
  });

  it.effect("fails when no android project exists", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      const result = yield* setAndroidUpdateChannel({ projectRoot: dir, channel: "x" }).pipe(
        Effect.either,
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(result._tag).toBe("Left");
    }).pipe(Effect.provide(NodeContext.layer)),
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
    }).pipe(Effect.ensuring(Effect.sync(dispose)), Effect.provide(NodeContext.layer));
  });

  it.effect("fails when no Expo.plist exists under ios/", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      mkdirSync(nodePath.join(dir, "ios"), { recursive: true });
      const result = yield* setIosUpdateChannel({
        iosDir: nodePath.join(dir, "ios"),
        channel: "production",
      }).pipe(Effect.either, Effect.ensuring(Effect.sync(dispose)));
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toContain("Expo.plist");
      }
    }).pipe(Effect.provide(NodeContext.layer)),
  );
});
