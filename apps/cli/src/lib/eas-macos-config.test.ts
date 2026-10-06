import { it } from "@effect/vitest";
import { Effect } from "effect";

import { fromGenericProfile } from "./build-profile";
import { parseEasConfig, resolveEasBuildProfile } from "./eas-config";
import { parseMacosProfile } from "./eas-macos-config";

describe(parseMacosProfile, () => {
  it("keeps known fields and drops values of the wrong type", () => {
    expect(
      parseMacosProfile({
        artifact: "pkg",
        notarize: false,
        notarizeTimeout: "45m",
        universal: "yes",
        distribution: "app-store",
        buildNumber: 7,
      }),
    ).toStrictEqual({ artifact: "pkg", notarize: false, notarizeTimeout: "45m", buildNumber: "7" });
  });

  it("takes the Tauri updater's .app.tar.gz and ignores an unknown container", () => {
    expect(parseMacosProfile({ artifact: "tar.gz" })).toStrictEqual({ artifact: "tar.gz" });
    expect(parseMacosProfile({ artifact: "tgz" })).toStrictEqual({});
  });
});

describe("macos build profile resolution", () => {
  it("defaults to a notarized DMG and leaves iOS/Android alone", () => {
    const profile = fromGenericProfile({ macos: {} }, "desktop");
    expect(profile.macos).toStrictEqual({
      distribution: "developer-id",
      artifact: "dmg",
      notarize: true,
      universal: false,
    });
    expect(profile.ios).toBeUndefined();
    expect(profile.android).toBeUndefined();
  });

  it("opts in through a custom macOS command alone", () => {
    const profile = fromGenericProfile(
      { custom: { macos: { command: "bun tauri build", artifactPath: "src-tauri/**/*.app" } } },
      "desktop",
    );
    expect(profile.macos?.artifact).toBe("dmg");
    expect(profile.customCommand?.macos?.command).toBe("bun tauri build");
  });

  it("is not implied by the shared distribution shorthand", () => {
    expect(fromGenericProfile({ distribution: "internal" }, "preview").macos).toBeUndefined();
  });

  it("builds Debug for a development-client profile unless overridden", () => {
    expect(fromGenericProfile({ developmentClient: true, macos: {} }, "dev").macos).toMatchObject({
      buildConfiguration: "Debug",
    });
  });

  it.effect("merges a macos section through extends", () =>
    Effect.gen(function* () {
      const config = yield* parseEasConfig(
        JSON.stringify({
          build: {
            base: { macos: { artifact: "zip", universal: true } },
            release: { extends: "base", macos: { notarizeTimeout: "1h" } },
          },
        }),
      );
      const resolved = yield* resolveEasBuildProfile(config, "release");
      expect(resolved.macos).toStrictEqual({
        artifact: "zip",
        universal: true,
        notarizeTimeout: "1h",
      });
    }),
  );
});
