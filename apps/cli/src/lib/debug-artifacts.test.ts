import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { collectAndroidDebugArtifacts } from "./debug-artifacts";

const withAndroidTree = (files: readonly string[]) => {
  const root = mkdtempSync(nodePath.join(tmpdir(), "debug-artifacts-test-"));
  for (const relative of files) {
    const full = nodePath.join(root, relative);
    mkdirSync(nodePath.dirname(full), { recursive: true });
    writeFileSync(full, "content");
  }
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
};

describe(collectAndroidDebugArtifacts, () => {
  it.effect("collects mapping.txt, RN sourcemap, and native symbols when present", () =>
    Effect.gen(function* () {
      const tree = withAndroidTree([
        "android/app/build/outputs/mapping/release/mapping.txt",
        "android/app/build/generated/sourcemaps/react/release/index.android.bundle.map",
        "android/app/build/outputs/native-debug-symbols/release/native-debug-symbols.zip",
      ]);

      const artifacts = yield* collectAndroidDebugArtifacts({
        projectRoot: tree.root,
        module: "app",
        minMtimeMs: 0,
      }).pipe(Effect.provide(NodeFileSystem.layer), Effect.ensuring(Effect.sync(tree.dispose)));

      expect(artifacts.map((artifact) => artifact.type).toSorted()).toStrictEqual([
        "js-sourcemap",
        "native-symbols",
        "proguard-mapping",
      ]);
    }),
  );

  it.effect("returns an empty list when no debug outputs exist", () =>
    Effect.gen(function* () {
      const tree = withAndroidTree(["android/app/build/outputs/apk/release/app-release.apk"]);

      const artifacts = yield* collectAndroidDebugArtifacts({
        projectRoot: tree.root,
        module: "app",
        minMtimeMs: 0,
      }).pipe(Effect.provide(NodeFileSystem.layer), Effect.ensuring(Effect.sync(tree.dispose)));

      expect(artifacts).toStrictEqual([]);
    }),
  );

  it.effect("rejects outputs older than the build start", () =>
    Effect.gen(function* () {
      const tree = withAndroidTree(["android/app/build/outputs/mapping/release/mapping.txt"]);

      const artifacts = yield* collectAndroidDebugArtifacts({
        projectRoot: tree.root,
        module: "app",
        minMtimeMs: Date.now() + 60_000,
      }).pipe(Effect.provide(NodeFileSystem.layer), Effect.ensuring(Effect.sync(tree.dispose)));

      expect(artifacts).toStrictEqual([]);
    }),
  );
});
