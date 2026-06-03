import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { findArtifactByGlob } from "./artifact-finder";

const makeDir = (): { readonly dir: string; readonly dispose: () => void } => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "artifact-glob-")));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
};

const write = (dir: string, rel: string): void => {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, "x");
};

describe(findArtifactByGlob, () => {
  it.effect("resolves a literal relative path", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      write(dir, "dist/app.aab");
      const found = yield* findArtifactByGlob({ baseDir: dir, pattern: "dist/app.aab" }).pipe(
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(found).toBe(path.join(dir, "dist/app.aab"));
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("matches a recursive glob by extension", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      write(dir, "app/build/outputs/bundle/release/app-release.aab");
      const found = yield* findArtifactByGlob({ baseDir: dir, pattern: "**/*.aab" }).pipe(
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(found.endsWith("app-release.aab")).toBe(true);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("scopes the search to the glob's fixed leading directory", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      write(dir, "build/MyApp.ipa");
      write(dir, "other/Decoy.ipa");
      const found = yield* findArtifactByGlob({ baseDir: dir, pattern: "build/*.ipa" }).pipe(
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(found).toBe(path.join(dir, "build/MyApp.ipa"));
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("fails when nothing matches", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      const result = yield* findArtifactByGlob({ baseDir: dir, pattern: "**/*.aab" }).pipe(
        Effect.either,
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(result._tag).toBe("Left");
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
