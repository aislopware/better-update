import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { ProjectNotLinkedError } from "./exit-codes";
import {
  extractProjectId,
  extractSlug,
  getConfigFilePaths,
  readExpoConfig,
  writeProjectId,
} from "./expo-config";
import { failureError } from "./test-utils";

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
