import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { ProjectNotLinkedError } from "./exit-codes";
import {
  expoSdkVersionFromPackageVersion,
  extractAppVersion,
  extractProjectId,
  extractRawRuntimeVersion,
  extractSlug,
  getConfigFilePaths,
  readAppMeta,
  readExpoConfig,
  writeProjectId,
} from "./expo-config";
import { failureError } from "./test-utils";

import type { ExpoConfig } from "./expo-config";

const writePackageJson = (dir: string): void => {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "expo-config-test", version: "1.0.0" }, null, 2),
  );
};

// @expo/config requires the project root to be a real path (not a symlink).
// On macOS `os.tmpdir()` resolves to /var/folders/... which is itself a symlink
// to /private/var/folders/... — pass through realpathSync to avoid mismatches.
const makeProjectDir = (prefix: string): string =>
  realpathSync(mkdtempSync(join(tmpdir(), prefix)));

const setupStaticProject = (
  config: Record<string, unknown>,
): { readonly dir: string; readonly dispose: () => void } => {
  const dir = makeProjectDir("expo-config-static-");
  writePackageJson(dir);
  writeFileSync(join(dir, "app.json"), JSON.stringify(config, null, 2));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
};

const setupDynamicProject = (
  jsBody: string,
): { readonly dir: string; readonly dispose: () => void } => {
  const dir = makeProjectDir("expo-config-dynamic-");
  writePackageJson(dir);
  writeFileSync(join(dir, "app.config.js"), jsBody);
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
};

describe(readExpoConfig, () => {
  it.effect("reads from app.json (static)", () =>
    Effect.gen(function* () {
      const project = setupStaticProject({
        expo: {
          name: "Static App",
          slug: "static-app",
          version: "1.0.0",
          extra: { betterUpdate: { projectId: "proj_static" } },
        },
      });
      const config = yield* readExpoConfig(project.dir).pipe(
        Effect.ensuring(Effect.sync(() => project.dispose())),
      );
      expect(config.name).toBe("Static App");
      expect(config.slug).toBe("static-app");
      expect(config.version).toBe("1.0.0");
      expect(config.extra?.betterUpdate?.projectId).toBe("proj_static");
    }),
  );

  it.effect("reads from app.config.js (dynamic, function form)", () =>
    Effect.gen(function* () {
      const project = setupDynamicProject(
        `module.exports = ({ config }) => ({
          ...config,
          name: "Dynamic App",
          slug: "dynamic-app",
          version: "2.0.0",
          extra: { betterUpdate: { projectId: "proj_dynamic" } },
        });`,
      );
      const config = yield* readExpoConfig(project.dir).pipe(
        Effect.ensuring(Effect.sync(() => project.dispose())),
      );
      expect(config.name).toBe("Dynamic App");
      expect(config.slug).toBe("dynamic-app");
      expect(config.extra?.betterUpdate?.projectId).toBe("proj_dynamic");
    }),
  );

  it.effect("applies env-var overlay so dynamic configs can read process.env", () =>
    Effect.gen(function* () {
      const project = setupDynamicProject(
        `module.exports = () => ({
          name: "EnvApp",
          slug: process.env.SLUG_FROM_ENV || "missing",
        });`,
      );
      const config = yield* readExpoConfig(project.dir, { SLUG_FROM_ENV: "from-env" }).pipe(
        Effect.ensuring(Effect.sync(() => project.dispose())),
      );
      expect(config.slug).toBe("from-env");
    }),
  );

  it.effect(
    "re-evaluates static-form dynamic configs on each call (no require.cache stickiness)",
    () =>
      Effect.gen(function* () {
        // Static-form (`module.exports = {...}`) reads `process.env` at module
        // load time. Without cache eviction the second readExpoConfig would
        // return the first-load object verbatim, ignoring the new overlay.
        const project = setupDynamicProject(
          `module.exports = {
          name: "StaticForm",
          slug: process.env.SLUG_FROM_ENV || "missing",
        };`,
        );
        const first = yield* readExpoConfig(project.dir, { SLUG_FROM_ENV: "first" });
        const second = yield* readExpoConfig(project.dir, { SLUG_FROM_ENV: "second" }).pipe(
          Effect.ensuring(Effect.sync(() => project.dispose())),
        );
        expect(first.slug).toBe("first");
        expect(second.slug).toBe("second");
      }),
  );

  it.effect("fails with ProjectNotLinkedError when projectRoot has no package.json", () =>
    Effect.gen(function* () {
      const dir = makeProjectDir("expo-config-no-pkg-");
      const exit = yield* readExpoConfig(dir).pipe(
        Effect.ensuring(Effect.sync(() => rmSync(dir, { recursive: true, force: true }))),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(failureError(exit)).toBeInstanceOf(ProjectNotLinkedError);
      }
    }),
  );
});

describe(extractProjectId, () => {
  it.effect("returns the projectId when present", () =>
    Effect.gen(function* () {
      const id = yield* extractProjectId({
        extra: { betterUpdate: { projectId: "proj_abc" } },
      });
      expect(id).toBe("proj_abc");
    }),
  );

  it.effect("fails when projectId is missing", () =>
    Effect.gen(function* () {
      const exit = yield* extractProjectId({}).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(failureError(exit)).toBeInstanceOf(ProjectNotLinkedError);
      }
    }),
  );
});

describe(extractSlug, () => {
  it.effect("returns the slug when present", () =>
    Effect.gen(function* () {
      const slug = yield* extractSlug({ slug: "my-app" });
      expect(slug).toBe("my-app");
    }),
  );

  it.effect("fails when slug is missing", () =>
    Effect.gen(function* () {
      const exit = yield* extractSlug({}).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});

describe(writeProjectId, () => {
  it.effect("writes projectId to a static app.json (success)", () =>
    Effect.gen(function* () {
      const project = setupStaticProject({
        expo: { name: "App", slug: "app", version: "1.0.0" },
      });
      const result = yield* writeProjectId(project.dir, "proj_new").pipe(
        Effect.ensuring(Effect.sync(() => project.dispose())),
      );
      expect(result.type).toBe("success");
      expect(result.configPath).toMatch(/app\.json$/);
    }),
  );

  it.effect("fails with ProjectNotLinkedError when only a dynamic config exists", () =>
    Effect.gen(function* () {
      const project = setupDynamicProject(
        `module.exports = () => ({ name: "DynOnly", slug: "dyn-only" });`,
      );
      const exit = yield* writeProjectId(project.dir, "proj_dyn").pipe(
        Effect.ensuring(Effect.sync(() => project.dispose())),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const err = failureError(exit);
        expect(err).toBeInstanceOf(ProjectNotLinkedError);
        expect(err!.message).toContain("manually");
        expect(err!.message).toContain("proj_dyn");
      }
    }),
  );
});

describe(readAppMeta, () => {
  it.effect("returns rawRuntimeVersion=undefined when runtimeVersion is null", () =>
    Effect.gen(function* () {
      // typeof null === "object" — without an explicit guard, downstream
      // resolveRuntimeVersion would destructure null and crash.
      const config = {
        ios: { bundleIdentifier: "com.example" },
        runtimeVersion: null,
      } as unknown as ExpoConfig;
      const meta = yield* readAppMeta(config, "ios");
      expect(meta.rawRuntimeVersion).toBeUndefined();
    }),
  );

  it.effect("returns the policy object when runtimeVersion has a policy", () =>
    Effect.gen(function* () {
      const meta = yield* readAppMeta(
        {
          android: { package: "com.example" },
          runtimeVersion: { policy: "appVersion" },
        },
        "android",
      );
      expect(meta.rawRuntimeVersion).toStrictEqual({ policy: "appVersion" });
    }),
  );

  it.effect("prefers per-platform ios.version over top-level version (EAS parity)", () =>
    Effect.gen(function* () {
      const meta = yield* readAppMeta(
        {
          version: "1.0.0",
          ios: { bundleIdentifier: "com.example", version: "9.9.9" },
        },
        "ios",
      );
      expect(meta.appVersion).toBe("9.9.9");
    }),
  );
});

describe(extractRawRuntimeVersion, () => {
  it("prefers ios.runtimeVersion over the top-level runtimeVersion (EAS parity)", () => {
    const config: ExpoConfig = {
      runtimeVersion: "1.0.0",
      ios: { bundleIdentifier: "com.example", runtimeVersion: { policy: "fingerprint" } },
    };
    expect(extractRawRuntimeVersion(config, "ios")).toStrictEqual({ policy: "fingerprint" });
  });

  it("prefers android.runtimeVersion over the top-level runtimeVersion", () => {
    const config: ExpoConfig = {
      runtimeVersion: { policy: "appVersion" },
      android: { package: "com.example", runtimeVersion: "2.0.0" },
    };
    expect(extractRawRuntimeVersion(config, "android")).toBe("2.0.0");
  });

  it("falls back to the top-level runtimeVersion when the platform has none", () => {
    const config: ExpoConfig = {
      runtimeVersion: { policy: "sdkVersion" },
      ios: { bundleIdentifier: "com.example" },
    };
    expect(extractRawRuntimeVersion(config, "ios")).toStrictEqual({ policy: "sdkVersion" });
  });

  it("does not leak the other platform's per-platform runtimeVersion", () => {
    const config: ExpoConfig = {
      runtimeVersion: "top",
      ios: { bundleIdentifier: "com.example", runtimeVersion: "ios-only" },
    };
    // android has no per-platform override → top-level wins, not the ios value.
    expect(extractRawRuntimeVersion(config, "android")).toBe("top");
  });
});

describe(extractAppVersion, () => {
  it("prefers the per-platform version", () => {
    expect(extractAppVersion({ version: "1.0.0", android: { version: "3.0.0" } }, "android")).toBe(
      "3.0.0",
    );
  });

  it("falls back to the top-level version", () => {
    expect(extractAppVersion({ version: "1.0.0" }, "ios")).toBe("1.0.0");
  });

  it("returns undefined when neither is set", () => {
    expect(extractAppVersion({}, "ios")).toBeUndefined();
  });
});

describe(expoSdkVersionFromPackageVersion, () => {
  it("reduces a patch version to major.0.0 (matching getExpoSDKVersionFromPackage)", () => {
    expect(expoSdkVersionFromPackageVersion("52.0.11")).toBe("52.0.0");
  });

  it("keeps an already-clean major version", () => {
    expect(expoSdkVersionFromPackageVersion("51.0.0")).toBe("51.0.0");
  });

  it("returns undefined for an empty version string", () => {
    expect(expoSdkVersionFromPackageVersion("")).toBeUndefined();
  });
});

describe(getConfigFilePaths, () => {
  it.effect("returns staticConfigPath for app.json projects", () =>
    Effect.gen(function* () {
      const project = setupStaticProject({ expo: { slug: "x" } });
      const paths = yield* getConfigFilePaths(project.dir).pipe(
        Effect.ensuring(Effect.sync(() => project.dispose())),
      );
      expect(paths.staticConfigPath).toMatch(/app\.json$/);
      expect(paths.dynamicConfigPath).toBeNull();
    }),
  );

  it.effect("returns dynamicConfigPath for app.config.js projects", () =>
    Effect.gen(function* () {
      const project = setupDynamicProject(`module.exports = () => ({ slug: "x" });`);
      const paths = yield* getConfigFilePaths(project.dir).pipe(
        Effect.ensuring(Effect.sync(() => project.dispose())),
      );
      expect(paths.dynamicConfigPath).toMatch(/app\.config\.js$/);
      expect(paths.staticConfigPath).toBeNull();
    }),
  );
});
