import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { buildIgnoreInstance, detectWorkspaceRoot, installArgs } from "./project-staging";

const makeDir = (prefix: string): string => realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

const dispose = (dir: string): void => {
  rmSync(dir, { recursive: true, force: true });
};

const touch = (file: string, content = ""): void => {
  writeFileSync(file, content);
};

describe(detectWorkspaceRoot, () => {
  it.effect("returns cwd + bun when no lockfile found", () =>
    Effect.gen(function* () {
      const dir = makeDir("staging-no-lockfile-");
      try {
        const result = yield* detectWorkspaceRoot(dir);
        expect(result.workspaceRoot).toBe(dir);
        expect(result.packageManager).toBe("bun");
        expect(result.lockfileFound).toBe(false);
      } finally {
        dispose(dir);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("detects bun.lock at cwd", () =>
    Effect.gen(function* () {
      const dir = makeDir("staging-bun-");
      touch(path.join(dir, "bun.lock"));
      try {
        const result = yield* detectWorkspaceRoot(dir);
        expect(result.workspaceRoot).toBe(dir);
        expect(result.packageManager).toBe("bun");
        expect(result.lockfileFound).toBe(true);
      } finally {
        dispose(dir);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("detects pnpm-lock.yaml at cwd", () =>
    Effect.gen(function* () {
      const dir = makeDir("staging-pnpm-");
      touch(path.join(dir, "pnpm-lock.yaml"));
      try {
        const result = yield* detectWorkspaceRoot(dir);
        expect(result.workspaceRoot).toBe(dir);
        expect(result.packageManager).toBe("pnpm");
      } finally {
        dispose(dir);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("detects yarn.lock at cwd", () =>
    Effect.gen(function* () {
      const dir = makeDir("staging-yarn-");
      touch(path.join(dir, "yarn.lock"));
      try {
        const result = yield* detectWorkspaceRoot(dir);
        expect(result.workspaceRoot).toBe(dir);
        expect(result.packageManager).toBe("yarn");
      } finally {
        dispose(dir);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("detects package-lock.json at cwd", () =>
    Effect.gen(function* () {
      const dir = makeDir("staging-npm-");
      touch(path.join(dir, "package-lock.json"));
      try {
        const result = yield* detectWorkspaceRoot(dir);
        expect(result.workspaceRoot).toBe(dir);
        expect(result.packageManager).toBe("npm");
      } finally {
        dispose(dir);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("walks up to monorepo root when lockfile is in parent", () =>
    Effect.gen(function* () {
      const root = makeDir("staging-monorepo-");
      touch(path.join(root, "bun.lock"));
      const appDir = path.join(root, "apps", "mobile");
      mkdirSync(appDir, { recursive: true });
      try {
        const result = yield* detectWorkspaceRoot(appDir);
        expect(result.workspaceRoot).toBe(root);
        expect(result.packageManager).toBe("bun");
      } finally {
        dispose(root);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("stops at first ancestor with a lockfile", () =>
    Effect.gen(function* () {
      const root = makeDir("staging-monorepo-nested-");
      touch(path.join(root, "bun.lock"));
      const subRoot = path.join(root, "packages", "internal");
      mkdirSync(subRoot, { recursive: true });
      touch(path.join(subRoot, "yarn.lock"));
      const appDir = path.join(subRoot, "app");
      mkdirSync(appDir);
      try {
        const result = yield* detectWorkspaceRoot(appDir);
        expect(result.workspaceRoot).toBe(subRoot);
        expect(result.packageManager).toBe("yarn");
      } finally {
        dispose(root);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});

describe(installArgs, () => {
  it("uses frozen-lockfile variants matching EAS when a lockfile was found", () => {
    expect(installArgs("bun", true)).toStrictEqual(["install", "--frozen-lockfile"]);
    expect(installArgs("pnpm", true)).toStrictEqual(["install", "--frozen-lockfile"]);
    expect(installArgs("yarn", true)).toStrictEqual(["install", "--frozen-lockfile"]);
    expect(installArgs("npm", true)).toStrictEqual(["ci", "--include=dev"]);
  });

  it("falls back to a plain install without a lockfile", () => {
    expect(installArgs("bun", false)).toStrictEqual(["install"]);
    expect(installArgs("pnpm", false)).toStrictEqual(["install"]);
    expect(installArgs("yarn", false)).toStrictEqual(["install"]);
    expect(installArgs("npm", false)).toStrictEqual(["install", "--include=dev"]);
  });
});

describe(buildIgnoreInstance, () => {
  it.effect("always ignores node_modules, .git, native build outputs", () =>
    Effect.gen(function* () {
      const dir = makeDir("ignore-defaults-");
      try {
        const ig = yield* buildIgnoreInstance(dir);
        expect(ig.ignores("node_modules/foo/index.js")).toBe(true);
        expect(ig.ignores(".git/HEAD")).toBe(true);
        expect(ig.ignores("ios/Pods/Manifest.lock")).toBe(true);
        expect(ig.ignores("ios/build/Debug-iphoneos/foo.app")).toBe(true);
        expect(ig.ignores("android/.gradle/8.0/file.lock")).toBe(true);
        expect(ig.ignores("android/app/build/outputs/apk/release/app.apk")).toBe(true);
        expect(ig.ignores(".expo/cache.json")).toBe(true);
        expect(ig.ignores("src/index.ts")).toBe(false);
        expect(ig.ignores("app.json")).toBe(false);
      } finally {
        dispose(dir);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("applies .gitignore on top of defaults", () =>
    Effect.gen(function* () {
      const dir = makeDir("ignore-gitignore-");
      writeFileSync(path.join(dir, ".gitignore"), "secret.env\n*.log\nbuild-output/\n");
      try {
        const ig = yield* buildIgnoreInstance(dir);
        expect(ig.ignores("secret.env")).toBe(true);
        expect(ig.ignores("debug.log")).toBe(true);
        expect(ig.ignores("build-output/index.html")).toBe(true);
        expect(ig.ignores("src/index.ts")).toBe(false);
        expect(ig.ignores("node_modules/anything")).toBe(true);
      } finally {
        dispose(dir);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("uses .easignore in place of .gitignore when both exist", () =>
    Effect.gen(function* () {
      const dir = makeDir("ignore-easignore-");
      writeFileSync(path.join(dir, ".gitignore"), "kept-by-easignore.txt\n");
      writeFileSync(path.join(dir, ".easignore"), "only-eas.txt\n");
      try {
        const ig = yield* buildIgnoreInstance(dir);
        expect(ig.ignores("only-eas.txt")).toBe(true);
        // .gitignore is ignored when .easignore is present.
        expect(ig.ignores("kept-by-easignore.txt")).toBe(false);
        // Always-ignore defaults still apply.
        expect(ig.ignores("node_modules/foo")).toBe(true);
      } finally {
        dispose(dir);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("falls back to defaults when neither ignore file exists", () =>
    Effect.gen(function* () {
      const dir = makeDir("ignore-none-");
      try {
        const ig = yield* buildIgnoreInstance(dir);
        expect(ig.ignores("node_modules/x")).toBe(true);
        expect(ig.ignores("README.md")).toBe(false);
      } finally {
        dispose(dir);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("re-includes native source dirs (but not build outputs) for non-Expo projects", () =>
    Effect.gen(function* () {
      const dir = makeDir("ignore-native-");
      // A bare-RN .gitignore that excludes the whole ios/android dirs.
      writeFileSync(path.join(dir, ".gitignore"), "ios/\nandroid/\n");
      try {
        const ig = yield* buildIgnoreInstance(dir, { includeNativeSource: true, appRelPath: "" });
        // Source files under the native dirs are force-included…
        expect(ig.ignores("ios/MyApp.xcodeproj/project.pbxproj")).toBe(false);
        expect(ig.ignores("android/app/build.gradle")).toBe(false);
        // …but generated build outputs stay excluded.
        expect(ig.ignores("ios/Pods/Manifest.lock")).toBe(true);
        expect(ig.ignores("android/app/build/outputs/apk/release/app.apk")).toBe(true);
      } finally {
        dispose(dir);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("honors a NESTED .gitignore scoped to its own directory (BU-6)", () =>
    Effect.gen(function* () {
      const root = makeDir("ignore-nested-");
      const app = path.join(root, "apps", "bigcommerce-app");
      mkdirSync(path.join(app, "ios"), { recursive: true });
      writeFileSync(path.join(root, ".gitignore"), "node_modules\n");
      // The custom xcodebuild derivedDataPath, ignored only in the nested file.
      writeFileSync(path.join(app, ".gitignore"), "ios/build-release/\n*.log\n");
      try {
        const ig = yield* buildIgnoreInstance(root);
        // The 9.2 GB build output dir (and everything under it) is excluded…
        expect(ig.ignores("apps/bigcommerce-app/ios/build-release/")).toBe(true);
        expect(ig.ignores("apps/bigcommerce-app/ios/build-release/Build/foo.o")).toBe(true);
        expect(ig.ignores("apps/bigcommerce-app/debug.log")).toBe(true);
        // …while the nested rules stay scoped to that app and don't leak up.
        expect(ig.ignores("apps/bigcommerce-app/src/index.ts")).toBe(false);
        expect(ig.ignores("ios/build-release/Build/foo.o")).toBe(false);
        expect(ig.ignores("other.log")).toBe(false);
      } finally {
        dispose(root);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("matches an unanchored nested pattern at any depth below its dir", () =>
    Effect.gen(function* () {
      const root = makeDir("ignore-nested-unanchored-");
      const app = path.join(root, "packages", "app");
      mkdirSync(app, { recursive: true });
      // No slash → matches at any depth within packages/app (git semantics).
      writeFileSync(path.join(app, ".gitignore"), "build-release\n");
      try {
        const ig = yield* buildIgnoreInstance(root);
        expect(ig.ignores("packages/app/build-release/x.o")).toBe(true);
        expect(ig.ignores("packages/app/ios/build-release/x.o")).toBe(true);
        expect(ig.ignores("packages/app/src/main.ts")).toBe(false);
        // Outside the nesting dir it has no effect.
        expect(ig.ignores("build-release/x.o")).toBe(false);
      } finally {
        dispose(root);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("ignores nested .gitignore files when a root .easignore is present", () =>
    Effect.gen(function* () {
      const root = makeDir("ignore-nested-easignore-");
      const app = path.join(root, "apps", "mobile");
      mkdirSync(app, { recursive: true });
      writeFileSync(path.join(root, ".easignore"), "only-eas.txt\n");
      writeFileSync(path.join(app, ".gitignore"), "nested-secret.txt\n");
      try {
        const ig = yield* buildIgnoreInstance(root);
        expect(ig.ignores("only-eas.txt")).toBe(true);
        // .easignore REPLACES every .gitignore (root and nested) — EAS semantics.
        expect(ig.ignores("apps/mobile/nested-secret.txt")).toBe(false);
      } finally {
        dispose(root);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("prunes ignored dirs — a nested .gitignore under one is not honored", () =>
    Effect.gen(function* () {
      const root = makeDir("ignore-nested-prune-");
      const buildDir = path.join(root, "build");
      mkdirSync(buildDir, { recursive: true });
      writeFileSync(path.join(root, ".gitignore"), "build/\n");
      // git can't re-include a file whose parent dir is excluded; the walk must
      // never descend into `build/`, so this re-include is never folded in.
      writeFileSync(path.join(buildDir, ".gitignore"), "!important.txt\n");
      try {
        const ig = yield* buildIgnoreInstance(root);
        expect(ig.ignores("build/important.txt")).toBe(true);
      } finally {
        dispose(root);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("scopes a nested re-exclude to a monorepo app for non-Expo projects", () =>
    Effect.gen(function* () {
      const root = makeDir("ignore-nested-native-");
      const app = path.join(root, "apps", "bare");
      mkdirSync(path.join(app, "ios"), { recursive: true });
      // The app ships committed ios/ source but ignores its derived data.
      writeFileSync(path.join(app, ".gitignore"), "ios/build-release/\n");
      try {
        const ig = yield* buildIgnoreInstance(root, {
          includeNativeSource: true,
          appRelPath: "apps/bare",
        });
        // Committed native source reaches staging…
        expect(ig.ignores("apps/bare/ios/MyApp.xcodeproj/project.pbxproj")).toBe(false);
        // …the always-excluded native outputs stay out…
        expect(ig.ignores("apps/bare/ios/Pods/Manifest.lock")).toBe(true);
        // …and the nested custom derived-data dir is excluded too.
        expect(ig.ignores("apps/bare/ios/build-release/Build/foo.o")).toBe(true);
      } finally {
        dispose(root);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
