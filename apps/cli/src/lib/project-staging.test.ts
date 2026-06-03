import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { buildIgnoreInstance, detectWorkspaceRoot } from "./project-staging";

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
});
