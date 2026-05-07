import { resolveUpdatePlatforms } from "./update-platforms";

import type { ExpoConfig } from "./expo-config";

describe(resolveUpdatePlatforms, () => {
  const fullConfig: ExpoConfig = {
    ios: { bundleIdentifier: "com.example.app" },
    android: { package: "com.example.app" },
  };

  it('returns both platforms when "all" is requested', () => {
    expect(resolveUpdatePlatforms(fullConfig, "all")).toStrictEqual(["ios", "android"]);
  });

  it("returns only the requested platform when it exists", () => {
    expect(resolveUpdatePlatforms(fullConfig, "ios")).toStrictEqual(["ios"]);
    expect(resolveUpdatePlatforms(fullConfig, "android")).toStrictEqual(["android"]);
  });

  it('returns configured platforms when "all" is requested against a partial config', () => {
    expect(
      resolveUpdatePlatforms(
        {
          ios: { bundleIdentifier: "com.example.app" },
        },
        "all",
      ),
    ).toStrictEqual(["ios"]);
  });

  it("returns the explicitly requested platform even when the config omits that section", () => {
    expect(
      resolveUpdatePlatforms(
        {
          ios: { bundleIdentifier: "com.example.app" },
        },
        "android",
      ),
    ).toStrictEqual(["android"]);
  });
});
