import { fromGenericProfile } from "./build-profile";
import { resolveAndroidStrategy, resolveIosStrategy } from "./build-strategy";

describe(resolveAndroidStrategy, () => {
  it("is expo for expo projects and gradle for non-expo projects", () => {
    const profile = fromGenericProfile(
      { android: { format: "aab", distribution: "play-store" } },
      "p",
    );
    expect(resolveAndroidStrategy(profile, "expo")).toBe("expo");
    expect(resolveAndroidStrategy(profile, "bare")).toBe("gradle");
    expect(resolveAndroidStrategy(profile, "kmp")).toBe("gradle");
    expect(resolveAndroidStrategy(profile, "native")).toBe("gradle");
  });

  it("is custom whenever a custom android command is declared", () => {
    const profile = fromGenericProfile(
      {
        android: { format: "aab", distribution: "play-store" },
        custom: { android: { command: "./build.sh", artifactPath: "**/*.aab" } },
      },
      "p",
    );
    expect(resolveAndroidStrategy(profile, "expo")).toBe("custom");
    expect(resolveAndroidStrategy(profile, "bare")).toBe("custom");
  });
});

describe(resolveIosStrategy, () => {
  it("is expo for expo projects and xcode for non-expo projects", () => {
    const profile = fromGenericProfile({ ios: { distribution: "app-store" } }, "p");
    expect(resolveIosStrategy(profile, "expo")).toBe("expo");
    expect(resolveIosStrategy(profile, "bare")).toBe("xcode");
    expect(resolveIosStrategy(profile, "native")).toBe("xcode");
  });

  it("is custom whenever a custom ios command is declared", () => {
    const profile = fromGenericProfile(
      {
        ios: { distribution: "app-store" },
        custom: { ios: { command: "fastlane build", artifactPath: "build/*.ipa" } },
      },
      "p",
    );
    expect(resolveIosStrategy(profile, "expo")).toBe("custom");
    expect(resolveIosStrategy(profile, "native")).toBe("custom");
  });
});
