import { describe, expect, it } from "vitest";

import { podInstallSteps } from "./ios-prepare";

const env = { LANG: "en_US.UTF-8" };

describe(podInstallSteps, () => {
  it("runs pod install through bundler when the project has a Gemfile", () => {
    const steps = podInstallSteps({
      projectRoot: "/app",
      iosDir: "/app/ios",
      hasGemfile: true,
      env,
    });
    expect(steps).toStrictEqual([
      {
        name: "bundle install",
        command: { command: "bundle", args: ["install"], cwd: "/app", env },
      },
      {
        name: "pod install",
        command: { command: "bundle", args: ["exec", "pod", "install"], cwd: "/app/ios", env },
      },
    ]);
  });

  it("runs plain pod install when there is no Gemfile", () => {
    const steps = podInstallSteps({
      projectRoot: "/app",
      iosDir: "/app/ios",
      hasGemfile: false,
      env,
    });
    expect(steps).toStrictEqual([
      { name: "pod install", command: { command: "pod", args: ["install"], cwd: "/app/ios", env } },
    ]);
  });
});
