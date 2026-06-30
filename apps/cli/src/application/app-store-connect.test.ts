import { it } from "@effect/vitest";
import AppleUtils from "@expo/apple-utils";
import { Effect, Exit } from "effect";

import { failureError } from "../lib/test-utils";
import { normalizePlatform, normalizeReleaseType } from "./app-store-connect";

describe(normalizePlatform, () => {
  it.effect("defaults to iOS when unset", () =>
    Effect.gen(function* () {
      expect(yield* normalizePlatform(undefined)).toBe(AppleUtils.Platform.IOS);
    }),
  );

  it.effect("accepts canonical names case-insensitively", () =>
    Effect.gen(function* () {
      expect(yield* normalizePlatform("ios")).toBe(AppleUtils.Platform.IOS);
      expect(yield* normalizePlatform("MAC_OS")).toBe(AppleUtils.Platform.MAC_OS);
    }),
  );

  it.effect("maps the short aliases", () =>
    Effect.gen(function* () {
      expect(yield* normalizePlatform("mac")).toBe(AppleUtils.Platform.MAC_OS);
      expect(yield* normalizePlatform("tv")).toBe(AppleUtils.Platform.TV_OS);
      expect(yield* normalizePlatform("vision")).toBe(AppleUtils.Platform.VISION_OS);
    }),
  );

  it.effect("rejects an unknown platform", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(normalizePlatform("windows"));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(failureError(exit)?.message).toContain('Unknown platform "windows"');
    }),
  );
});

describe(normalizeReleaseType, () => {
  it.effect("returns undefined when unset (leaves the version untouched)", () =>
    Effect.gen(function* () {
      expect(yield* normalizeReleaseType(undefined)).toBeUndefined();
    }),
  );

  it.effect("maps the three release types case-insensitively", () =>
    Effect.gen(function* () {
      expect(yield* normalizeReleaseType("manual")).toBe(AppleUtils.ReleaseType.MANUAL);
      expect(yield* normalizeReleaseType("AFTER_APPROVAL")).toBe(
        AppleUtils.ReleaseType.AFTER_APPROVAL,
      );
      expect(yield* normalizeReleaseType("Scheduled")).toBe(AppleUtils.ReleaseType.SCHEDULED);
    }),
  );

  it.effect("rejects an unknown release type", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(normalizeReleaseType("whenever"));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(failureError(exit)?.message).toContain('Unknown --release-type "whenever"');
    }),
  );
});
