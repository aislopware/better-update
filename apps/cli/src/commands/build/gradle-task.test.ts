import { gradleTaskArgs } from "./gradle-task";

import type { AndroidProfile } from "../../lib/build-profile";

const profile = (overrides: Partial<AndroidProfile> = {}): AndroidProfile => ({
  format: "aab",
  distribution: "play-store",
  ...overrides,
});

describe(gradleTaskArgs, () => {
  it("derives the task and assembles the universal APK in the same run for an aab", () => {
    expect(gradleTaskArgs(profile())).toStrictEqual({
      args: [":app:bundleRelease", ":app:assembleRelease"],
      universalApkViaGradle: true,
    });
  });

  it("passes gradleCommand through as written, split on whitespace", () => {
    expect(
      gradleTaskArgs(profile({ gradleCommand: "  :app:bundleProdRelease  --stacktrace " })),
    ).toStrictEqual({
      args: [":app:bundleProdRelease", "--stacktrace"],
      universalApkViaGradle: false,
    });
    expect(gradleTaskArgs(profile({ gradleCommand: "assembleRelease" })).args).toStrictEqual([
      "assembleRelease",
    ]);
  });

  it("lets gradleTask win over gradleCommand and prefixes it with the module", () => {
    expect(
      gradleTaskArgs(
        profile({ gradleTask: "bundleRelease", gradleCommand: "clean", module: "phone" }),
      ),
    ).toStrictEqual({ args: [":phone:bundleRelease"], universalApkViaGradle: false });
  });

  it("ignores a blank gradleCommand", () => {
    expect(gradleTaskArgs(profile({ format: "apk", gradleCommand: "   " })).args).toStrictEqual([
      ":app:assembleRelease",
    ]);
  });
});
