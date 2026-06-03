import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { asProjectType, detectProjectType } from "./detect-project-type";

const makeDir = (): { readonly dir: string; readonly dispose: () => void } => {
  const dir = mkdtempSync(path.join(tmpdir(), "detect-project-type-"));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
};

const write = (dir: string, rel: string, content = ""): void => {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
};

describe(asProjectType, () => {
  it("accepts known values and rejects everything else", () => {
    expect(asProjectType("kmp")).toBe("kmp");
    expect(asProjectType("expo")).toBe("expo");
    expect(asProjectType("nope")).toBeUndefined();
    expect(asProjectType(42)).toBeUndefined();
  });
});

describe(detectProjectType, () => {
  it.effect("returns the override unconditionally", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      // An app.json would otherwise look like expo — the override must still win.
      write(dir, "app.json", "{}");
      const type = yield* detectProjectType({ projectRoot: dir, override: "custom" }).pipe(
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(type).toBe("custom");
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("detects expo from an app.json", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      write(dir, "app.json", JSON.stringify({ expo: { name: "x" } }));
      const type = yield* detectProjectType({ projectRoot: dir }).pipe(
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(type).toBe("expo");
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("detects kmp from a composeApp module in settings.gradle.kts", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      write(dir, "settings.gradle.kts", 'include(":composeApp")');
      const type = yield* detectProjectType({ projectRoot: dir }).pipe(
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(type).toBe("kmp");
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("detects bare RN from android/ + ios/ + package.json without expo", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      write(dir, "package.json", JSON.stringify({ dependencies: { "react-native": "0.74.0" } }));
      write(dir, "android/app/build.gradle", "android {}");
      write(dir, "ios/App.xcodeproj/project.pbxproj", "// pbx");
      const type = yield* detectProjectType({ projectRoot: dir }).pipe(
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(type).toBe("bare");
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("falls back to native for a lone android dir with no package.json", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeDir();
      write(dir, "android/app/build.gradle", "android {}");
      const type = yield* detectProjectType({ projectRoot: dir }).pipe(
        Effect.ensuring(Effect.sync(dispose)),
      );
      expect(type).toBe("native");
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
