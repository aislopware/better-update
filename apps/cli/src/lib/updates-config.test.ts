import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { InvalidArgumentError } from "./exit-codes";
import { readExpoConfig, writeExpoConfigPatch } from "./expo-config";
import { failureError } from "./test-utils";
import {
  buildUpdatesPatch,
  CONFIGURE_DEFAULTS,
  describeUpdatesPatch,
  extractExistingUpdatesConfig,
  parseRequestHeaders,
  RUNTIME_POLICIES,
  validateCheckAutomatically,
  validateFallbackTimeout,
  validateRuntimePolicy,
} from "./updates-config";

import type { ExpoConfig } from "./expo-config";
import type { UpdatesConfigInput } from "./updates-config";

const baseInput: UpdatesConfigInput = {
  manifestUrl: "https://better-update.dev/manifest/proj_abc",
  runtimePolicy: CONFIGURE_DEFAULTS.runtimePolicy,
  enabled: CONFIGURE_DEFAULTS.enabled,
  checkAutomatically: CONFIGURE_DEFAULTS.checkAutomatically,
  fallbackToCacheTimeout: CONFIGURE_DEFAULTS.fallbackToCacheTimeout,
  useEmbeddedUpdate: CONFIGURE_DEFAULTS.useEmbeddedUpdate,
  enableBsdiffPatchSupport: CONFIGURE_DEFAULTS.enableBsdiffPatchSupport,
  disableAntiBrickingMeasures: CONFIGURE_DEFAULTS.disableAntiBrickingMeasures,
};

describe(buildUpdatesPatch, () => {
  it("writes enableBsdiffPatchSupport: true by default", () => {
    const patch = buildUpdatesPatch(baseInput);
    expect(patch.updates.enableBsdiffPatchSupport).toBe(true);
  });

  it("writes the runtimeVersion policy as the top-level policy object", () => {
    expect(
      buildUpdatesPatch({ ...baseInput, runtimePolicy: "fingerprint" }).runtimeVersion,
    ).toStrictEqual({ policy: "fingerprint" });
    expect(
      buildUpdatesPatch({ ...baseInput, runtimePolicy: "appVersion" }).runtimeVersion,
    ).toStrictEqual({ policy: "appVersion" });
  });

  it("accepts every expo runtime-version policy in the patch", () => {
    for (const policy of RUNTIME_POLICIES) {
      expect(
        buildUpdatesPatch({ ...baseInput, runtimePolicy: policy }).runtimeVersion,
      ).toStrictEqual({
        policy,
      });
    }
  });

  it("defaults enableBsdiffPatchSupport to true on a fresh configure (no flag, no existing)", () => {
    // fresh configure: only manifestUrl provided, no flags, no existing config
    const patch = buildUpdatesPatch({ manifestUrl: baseInput.manifestUrl });
    expect(patch.updates.enableBsdiffPatchSupport).toBe(true);
    // anti-bricking measures stay ACTIVE by default (disable flag off)
    expect(patch.updates.disableAntiBrickingMeasures).toBe(false);
    // every other field falls back to its SDK-56 default too
    expect(patch.updates).toStrictEqual({
      url: baseInput.manifestUrl,
      enabled: true,
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 0,
      useEmbeddedUpdate: true,
      enableBsdiffPatchSupport: true,
      disableAntiBrickingMeasures: false,
    });
    expect(patch.runtimeVersion).toStrictEqual({ policy: "appVersion" });
  });

  it("merges --force: preserves existing fields the user didn't pass, applies the one they did", () => {
    // existing config the user previously set
    const existing = {
      runtimePolicy: "fingerprint",
      enabled: true,
      checkAutomatically: "WIFI_ONLY",
      fallbackToCacheTimeout: 12_000,
      useEmbeddedUpdate: false,
      enableBsdiffPatchSupport: false,
      disableAntiBrickingMeasures: true,
      requestHeaders: { "x-team": "core" },
    } as const;

    // user re-runs configure passing ONLY --enable-bsdiff
    const patch = buildUpdatesPatch({
      manifestUrl: baseInput.manifestUrl,
      enableBsdiffPatchSupport: true,
      existing,
    });

    // the one explicit flag wins
    expect(patch.updates.enableBsdiffPatchSupport).toBe(true);
    // everything the user did NOT pass is preserved from existing
    expect(patch.runtimeVersion).toStrictEqual({ policy: "fingerprint" });
    expect(patch.updates.checkAutomatically).toBe("WIFI_ONLY");
    expect(patch.updates.fallbackToCacheTimeout).toBe(12_000);
    expect(patch.updates.useEmbeddedUpdate).toBe(false);
    expect(patch.updates.enabled).toBe(true);
    // a previously-disabled anti-bricking setting survives an unrelated re-run
    expect(patch.updates.disableAntiBrickingMeasures).toBe(true);
    expect(patch.updates.requestHeaders).toStrictEqual({ "x-team": "core" });
  });

  it("explicit flag beats existing; existing beats default", () => {
    const patch = buildUpdatesPatch({
      manifestUrl: baseInput.manifestUrl,
      // explicit beats both existing and default
      checkAutomatically: "NEVER",
      existing: {
        // no checkAutomatically here; fallbackToCacheTimeout existing beats default 0
        fallbackToCacheTimeout: 9000,
      },
    });
    expect(patch.updates.checkAutomatically).toBe("NEVER");
    expect(patch.updates.fallbackToCacheTimeout).toBe(9000);
    // unset everywhere → default
    expect(patch.updates.useEmbeddedUpdate).toBe(true);
  });

  it("includes the full expo-updates surface with SDK-56 defaults", () => {
    const { updates } = buildUpdatesPatch(baseInput);
    expect(updates).toStrictEqual({
      url: "https://better-update.dev/manifest/proj_abc",
      enabled: true,
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 0,
      useEmbeddedUpdate: true,
      enableBsdiffPatchSupport: true,
      disableAntiBrickingMeasures: false,
    });
  });

  it("can opt into disabling anti-bricking measures", () => {
    expect(
      buildUpdatesPatch({ ...baseInput, disableAntiBrickingMeasures: true }).updates
        .disableAntiBrickingMeasures,
    ).toBe(true);
  });

  it("an explicit false beats an existing true (input wins over existing)", () => {
    const patch = buildUpdatesPatch({
      manifestUrl: baseInput.manifestUrl,
      disableAntiBrickingMeasures: false,
      existing: { disableAntiBrickingMeasures: true },
    });
    expect(patch.updates.disableAntiBrickingMeasures).toBe(false);
  });

  it("omits requestHeaders when not provided", () => {
    expect("requestHeaders" in buildUpdatesPatch(baseInput).updates).toBe(false);
  });

  it("includes requestHeaders when provided", () => {
    const patch = buildUpdatesPatch({ ...baseInput, requestHeaders: { "x-team": "core" } });
    expect(patch.updates.requestHeaders).toStrictEqual({ "x-team": "core" });
  });

  it("can opt out of bsdiff", () => {
    expect(
      buildUpdatesPatch({ ...baseInput, enableBsdiffPatchSupport: false }).updates
        .enableBsdiffPatchSupport,
    ).toBe(false);
  });
});

describe(validateRuntimePolicy, () => {
  it.effect("accepts all four expo runtime-version policies", () =>
    Effect.gen(function* () {
      for (const policy of ["sdkVersion", "nativeVersion", "appVersion", "fingerprint"] as const) {
        expect(yield* validateRuntimePolicy(policy)).toBe(policy);
      }
    }),
  );

  it.effect("exposes the four policies as the single RUNTIME_POLICIES source", () =>
    Effect.gen(function* () {
      expect([...RUNTIME_POLICIES].toSorted()).toStrictEqual([
        "appVersion",
        "fingerprint",
        "nativeVersion",
        "sdkVersion",
      ]);
    }),
  );

  it.effect("passes undefined through (flag not passed → preserve existing)", () =>
    Effect.gen(function* () {
      expect(yield* validateRuntimePolicy(undefined)).toBeUndefined();
    }),
  );

  it.effect("rejects unknown policy with InvalidArgumentError listing all policies", () =>
    Effect.gen(function* () {
      const exit = yield* validateRuntimePolicy("bogus").pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const err = failureError(exit);
        expect(err).toBeInstanceOf(InvalidArgumentError);
        expect(err!.message).toContain("bogus");
        // help/validator share one source: every policy appears in the message
        for (const policy of RUNTIME_POLICIES) {
          expect(err!.message).toContain(policy);
        }
      }
    }),
  );
});

describe(validateCheckAutomatically, () => {
  it.effect("accepts every documented enum value", () =>
    Effect.gen(function* () {
      for (const value of ["ON_LOAD", "ON_ERROR_RECOVERY", "WIFI_ONLY", "NEVER"] as const) {
        expect(yield* validateCheckAutomatically(value)).toBe(value);
      }
    }),
  );

  it.effect("passes undefined through (flag not passed → preserve existing)", () =>
    Effect.gen(function* () {
      expect(yield* validateCheckAutomatically(undefined)).toBeUndefined();
    }),
  );

  it.effect("rejects a bad enum value with a clear error", () =>
    Effect.gen(function* () {
      const exit = yield* validateCheckAutomatically("ALWAYS").pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const err = failureError(exit);
        expect(err).toBeInstanceOf(InvalidArgumentError);
        expect(err!.message).toContain("ON_LOAD");
        expect(err!.message).toContain("ALWAYS");
      }
    }),
  );
});

describe(validateFallbackTimeout, () => {
  it.effect("accepts integers within 0..300000", () =>
    Effect.gen(function* () {
      expect(yield* validateFallbackTimeout("0")).toBe(0);
      expect(yield* validateFallbackTimeout("300000")).toBe(300_000);
      expect(yield* validateFallbackTimeout(5000)).toBe(5000);
    }),
  );

  it.effect("passes undefined through (flag not passed → preserve existing)", () =>
    Effect.gen(function* () {
      expect(yield* validateFallbackTimeout(undefined)).toBeUndefined();
    }),
  );

  it.effect("rejects out-of-range, negative, and non-integer values", () =>
    Effect.gen(function* () {
      for (const bad of ["-1", "300001", "abc", "1.5"]) {
        const exit = yield* validateFallbackTimeout(bad).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(failureError(exit)).toBeInstanceOf(InvalidArgumentError);
        }
      }
    }),
  );
});

describe(parseRequestHeaders, () => {
  it.effect("returns undefined when no headers are passed", () =>
    Effect.gen(function* () {
      expect(yield* parseRequestHeaders(undefined)).toBeUndefined();
      expect(yield* parseRequestHeaders([])).toBeUndefined();
    }),
  );

  it.effect("parses a single KEY=VALUE", () =>
    Effect.gen(function* () {
      expect(yield* parseRequestHeaders("x-channel=prod")).toStrictEqual({ "x-channel": "prod" });
    }),
  );

  it.effect("parses multiple headers and keeps = inside values", () =>
    Effect.gen(function* () {
      expect(yield* parseRequestHeaders(["x-one=1", "x-two=p=q"])).toStrictEqual({
        "x-one": "1",
        "x-two": "p=q",
      });
    }),
  );

  it.effect("rejects entries without =", () =>
    Effect.gen(function* () {
      const exit = yield* parseRequestHeaders("nope").pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(failureError(exit)).toBeInstanceOf(InvalidArgumentError);
      }
    }),
  );
});

describe(describeUpdatesPatch, () => {
  it("emits every written field as a key/value row", () => {
    const rows = describeUpdatesPatch(buildUpdatesPatch(baseInput));
    const keys = rows.map(([key]) => key);
    expect(keys).toContain("updates.enableBsdiffPatchSupport");
    expect(keys).toContain("updates.disableAntiBrickingMeasures");
    expect(keys).toContain("runtimeVersion.policy");
    expect(keys).toContain("updates.checkAutomatically");
    const bsdiff = rows.find(([key]) => key === "updates.enableBsdiffPatchSupport");
    expect(bsdiff?.[1]).toBe("true");
    const antiBrick = rows.find(([key]) => key === "updates.disableAntiBrickingMeasures");
    expect(antiBrick?.[1]).toBe("false");
  });
});

describe(extractExistingUpdatesConfig, () => {
  it("reads a populated config into the preserve-shape", () => {
    const config: ExpoConfig = {
      runtimeVersion: { policy: "nativeVersion" },
      updates: {
        url: "https://example.dev/manifest/p",
        enabled: false,
        checkAutomatically: "ON_ERROR_RECOVERY",
        fallbackToCacheTimeout: 7000,
        useEmbeddedUpdate: false,
        enableBsdiffPatchSupport: true,
        disableAntiBrickingMeasures: true,
        requestHeaders: { "x-a": "1" },
      },
    };
    expect(extractExistingUpdatesConfig(config)).toStrictEqual({
      runtimePolicy: "nativeVersion",
      enabled: false,
      checkAutomatically: "ON_ERROR_RECOVERY",
      fallbackToCacheTimeout: 7000,
      useEmbeddedUpdate: false,
      enableBsdiffPatchSupport: true,
      disableAntiBrickingMeasures: true,
      requestHeaders: { "x-a": "1" },
    });
  });

  it("drops unrecognized enum values and a string runtimeVersion (not a policy)", () => {
    const config: ExpoConfig = {
      runtimeVersion: "1.0.0",
      updates: { checkAutomatically: "ALWAYS_MAYBE" },
    };
    const existing = extractExistingUpdatesConfig(config);
    expect("runtimePolicy" in existing).toBe(false);
    expect("checkAutomatically" in existing).toBe(false);
  });

  it("drops a non-boolean disableAntiBrickingMeasures (falls through to default)", () => {
    const config = {
      updates: { disableAntiBrickingMeasures: "yes" },
    } as unknown as ExpoConfig;
    const existing = extractExistingUpdatesConfig(config);
    expect("disableAntiBrickingMeasures" in existing).toBe(false);
  });

  it("reads a boolean disableAntiBrickingMeasures", () => {
    const config: ExpoConfig = {
      updates: { disableAntiBrickingMeasures: true },
    };
    expect(extractExistingUpdatesConfig(config).disableAntiBrickingMeasures).toBe(true);
  });

  it("returns an empty object for a config with no updates surface", () => {
    expect(extractExistingUpdatesConfig({ name: "x" })).toStrictEqual({});
  });
});

// @expo/config requires a real (non-symlink) project root. macOS tmpdir is a
// symlink to /private/var/... so realpath before use.
const makeProjectDir = (prefix: string): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

const setupStaticProject = (
  config: Record<string, unknown>,
): { readonly dir: string; readonly dispose: () => void } => {
  const dir = makeProjectDir("updates-config-");
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "updates-config-test", version: "1.0.0" }, null, 2),
  );
  writeFileSync(path.join(dir, "app.json"), JSON.stringify(config, null, 2));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
};

describe("configure write through writeExpoConfigPatch", () => {
  it.effect("writes enableBsdiffPatchSupport: true and preserves unrelated keys", () =>
    Effect.gen(function* () {
      const project = setupStaticProject({
        expo: {
          name: "My App",
          slug: "my-app",
          version: "1.0.0",
          orientation: "portrait",
          ios: { bundleIdentifier: "com.example.app" },
          extra: { betterUpdate: { projectId: "proj_abc" }, eas: { projectId: "eas_xyz" } },
        },
      });

      const patch = buildUpdatesPatch({ ...baseInput, runtimePolicy: "fingerprint" });
      const result = yield* writeExpoConfigPatch(project.dir, patch);
      expect(result.type).toBe("success");

      const raw = JSON.parse(readFileSync(path.join(project.dir, "app.json"), "utf8")) as {
        expo: Record<string, unknown>;
      };
      project.dispose();

      const { expo } = raw;
      const updates = expo["updates"] as Record<string, unknown>;
      // critical: device-side bsdiff toggle landed
      expect(updates["enableBsdiffPatchSupport"]).toBe(true);
      // anti-bricking measures stay active by default in the written file
      expect(updates["disableAntiBrickingMeasures"]).toBe(false);
      expect(updates["url"]).toBe("https://better-update.dev/manifest/proj_abc");
      expect(updates["checkAutomatically"]).toBe("ON_LOAD");
      expect(updates["fallbackToCacheTimeout"]).toBe(0);
      // runtimeVersion policy written at top level
      expect(expo["runtimeVersion"]).toStrictEqual({ policy: "fingerprint" });
      // unrelated keys preserved (merge, not clobber)
      expect(expo["name"]).toBe("My App");
      expect(expo["orientation"]).toBe("portrait");
      expect(expo["ios"]).toStrictEqual({ bundleIdentifier: "com.example.app" });
      expect(expo["extra"]).toStrictEqual({
        betterUpdate: { projectId: "proj_abc" },
        eas: { projectId: "eas_xyz" },
      });
    }),
  );

  it.effect("re-reading the written config exposes the typed updates shape", () =>
    Effect.gen(function* () {
      const project = setupStaticProject({
        expo: { name: "App", slug: "app", version: "1.0.0" },
      });
      yield* writeExpoConfigPatch(project.dir, buildUpdatesPatch(baseInput));
      const config = yield* readExpoConfig(project.dir).pipe(
        Effect.ensuring(Effect.sync(() => project.dispose())),
      );
      expect(config.updates?.enableBsdiffPatchSupport).toBe(true);
      expect(config.updates?.url).toBe("https://better-update.dev/manifest/proj_abc");
    }),
  );

  it.effect(
    "--force preserves an existing updates.* value the user didn't pass while applying one they did",
    () =>
      Effect.gen(function* () {
        // a project that already configured updates.* the way the user wanted
        const project = setupStaticProject({
          expo: {
            name: "App",
            slug: "app",
            version: "1.0.0",
            extra: { betterUpdate: { projectId: "proj_abc" } },
            runtimeVersion: { policy: "fingerprint" },
            updates: {
              url: "https://better-update.dev/manifest/proj_abc",
              enabled: true,
              checkAutomatically: "WIFI_ONLY",
              fallbackToCacheTimeout: 12_000,
              useEmbeddedUpdate: true,
              enableBsdiffPatchSupport: false,
            },
          },
        });

        // emulate the command: read existing → build patch with only --enable-bsdiff → write
        const before = yield* readExpoConfig(project.dir);
        const patch = buildUpdatesPatch({
          manifestUrl: "https://better-update.dev/manifest/proj_abc",
          enableBsdiffPatchSupport: true,
          existing: extractExistingUpdatesConfig(before),
        });
        yield* writeExpoConfigPatch(project.dir, patch);

        const after = yield* readExpoConfig(project.dir).pipe(
          Effect.ensuring(Effect.sync(() => project.dispose())),
        );

        // the single explicitly-passed flag applied...
        expect(after.updates?.enableBsdiffPatchSupport).toBe(true);
        // ...and the values the user did NOT pass survived the rewrite
        expect(after.updates?.checkAutomatically).toBe("WIFI_ONLY");
        expect(after.updates?.fallbackToCacheTimeout).toBe(12_000);
        expect(after.runtimeVersion).toStrictEqual({ policy: "fingerprint" });
      }),
  );
});
