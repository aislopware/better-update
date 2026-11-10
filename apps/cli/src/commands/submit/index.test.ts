import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { it } from "@effect/vitest";
import { Effect } from "effect";

import { resolveSubmitBundleIdentifier } from "./index";

describe(resolveSubmitBundleIdentifier, () => {
  it.effect("prefers the submit profile's bundle id", () =>
    Effect.gen(function* () {
      expect(
        yield* resolveSubmitBundleIdentifier({
          iosProfile: { bundleIdentifier: "com.example.profile" },
          buildBundleId: "com.example.build",
          projectRoot: "/nonexistent",
        }),
      ).toBe("com.example.profile");
    }),
  );

  it.effect("falls back to the bundle id the submitted build recorded", () =>
    Effect.gen(function* () {
      expect(
        yield* resolveSubmitBundleIdentifier({
          iosProfile: {},
          buildBundleId: "com.example.build",
          projectRoot: "/nonexistent",
        }),
      ).toBe("com.example.build");
    }),
  );

  it.live("is undefined when no profile, build or Expo config names one", () =>
    Effect.acquireUseRelease(
      Effect.promise(async () => mkdtemp(path.join(tmpdir(), "submit-bundle-id-"))),
      (projectRoot) =>
        Effect.gen(function* () {
          expect(
            yield* resolveSubmitBundleIdentifier({
              iosProfile: undefined,
              buildBundleId: undefined,
              projectRoot,
            }),
          ).toBeUndefined();
        }),
      (projectRoot) => Effect.promise(async () => rm(projectRoot, { recursive: true })),
    ),
  );
});
