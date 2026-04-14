import { resolveUpdatePlatforms } from "./update-platforms";

describe(resolveUpdatePlatforms, () => {
  const fullConfig = {
    expo: {
      ios: { bundleIdentifier: "com.example.app" },
      android: { package: "com.example.app" },
    },
  } satisfies Record<string, unknown>;

  test('returns both platforms when "all" is requested', () => {
    expect(resolveUpdatePlatforms(fullConfig, "all")).toEqual(["ios", "android"]);
  });

  test("returns only the requested platform when it exists", () => {
    expect(resolveUpdatePlatforms(fullConfig, "ios")).toEqual(["ios"]);
    expect(resolveUpdatePlatforms(fullConfig, "android")).toEqual(["android"]);
  });

  test('returns configured platforms when "all" is requested against a partial config', () => {
    expect(
      resolveUpdatePlatforms(
        {
          expo: {
            ios: { bundleIdentifier: "com.example.app" },
          },
        },
        "all",
      ),
    ).toEqual(["ios"]);
  });

  test("returns the explicitly requested platform even when app.json omits that section", () => {
    expect(
      resolveUpdatePlatforms(
        {
          expo: {
            ios: { bundleIdentifier: "com.example.app" },
          },
        },
        "android",
      ),
    ).toEqual(["android"]);
  });
});
