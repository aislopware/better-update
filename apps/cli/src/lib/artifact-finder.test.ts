import { FileSystem } from "@effect/platform";
import { it } from "@effect/vitest";
import { Effect, Exit, Option } from "effect";

import { findAndroidArtifact, findIosArtifact } from "./artifact-finder";
import { ArtifactNotFoundError } from "./exit-codes";
import { failureError } from "./test-utils";

// ── fake FS ───────────────────────────────────────────────────────

interface FakeFile {
  readonly type: "File";
  readonly mtimeMs: number;
}
interface FakeDir {
  readonly type: "Directory";
}
type FakeEntry = FakeFile | FakeDir;

const mkInfo = (entry: FakeEntry) =>
  ({
    type: entry.type,
    mtime: entry.type === "File" ? Option.some(new Date(entry.mtimeMs)) : Option.none<Date>(),
    atime: Option.none<Date>(),
    birthtime: Option.none<Date>(),
    dev: 0,
    ino: Option.none<number>(),
    mode: 0o644,
    nlink: Option.none<number>(),
    uid: Option.none<number>(),
    gid: Option.none<number>(),
    rdev: Option.none<number>(),
    size: 0n,
    blksize: Option.none<bigint>(),
    blocks: Option.none<number>(),
  }) as unknown as FileSystem.File.Info;

const makeFakeFs = (entries: Record<string, FakeEntry>) => {
  const paths = new Set(Object.keys(entries));
  return FileSystem.layerNoop({
    exists: (targetPath: string) => Effect.succeed(paths.has(targetPath)),
    readDirectory: (targetPath: string) =>
      Effect.sync(() => {
        const prefix = `${targetPath}/`;
        const children = new Set<string>();
        for (const full of paths) {
          if (full.startsWith(prefix)) {
            const rest = full.slice(prefix.length);
            const [head] = rest.split("/");
            if (head) {
              children.add(head);
            }
          }
        }
        return [...children];
      }),
    stat: (targetPath: string) => {
      const entry = entries[targetPath];
      if (!entry) {
        return Effect.die(new Error(`ENOENT: ${targetPath}`));
      }
      return Effect.succeed(mkInfo(entry));
    },
  });
};

// ── iOS tests ─────────────────────────────────────────────────────

describe(findIosArtifact, () => {
  it.effect("returns the newest .ipa under exportPath", () =>
    Effect.gen(function* () {
      const fs = makeFakeFs({
        "/export": { type: "Directory" },
        "/export/OldBuild.ipa": { type: "File", mtimeMs: 1000 },
        "/export/NewBuild.ipa": { type: "File", mtimeMs: 5000 },
        "/export/notes.txt": { type: "File", mtimeMs: 6000 },
      });
      const result = yield* findIosArtifact({ exportPath: "/export" }).pipe(Effect.provide(fs));
      expect(result).toBe("/export/NewBuild.ipa");
    }),
  );

  it.effect("fails when no .ipa found", () =>
    Effect.gen(function* () {
      const fs = makeFakeFs({
        "/export": { type: "Directory" },
        "/export/readme.md": { type: "File", mtimeMs: 1 },
      });
      const exit = yield* findIosArtifact({ exportPath: "/export" }).pipe(
        Effect.provide(fs),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(ArtifactNotFoundError);
      }
    }),
  );

  it.effect("returns nested .ipa via walk", () =>
    Effect.gen(function* () {
      const fs = makeFakeFs({
        "/export": { type: "Directory" },
        "/export/nested": { type: "Directory" },
        "/export/nested/inner.ipa": { type: "File", mtimeMs: 9000 },
      });
      const result = yield* findIosArtifact({ exportPath: "/export" }).pipe(Effect.provide(fs));
      expect(result).toBe("/export/nested/inner.ipa");
    }),
  );
});

// ── Android tests ─────────────────────────────────────────────────

describe(findAndroidArtifact, () => {
  it.effect("finds .aab at expected Gradle output path (no flavor)", () =>
    Effect.gen(function* () {
      const fs = makeFakeFs({
        "/project/android/app/build/outputs": { type: "Directory" },
        "/project/android/app/build/outputs/bundle": { type: "Directory" },
        "/project/android/app/build/outputs/bundle/release": { type: "Directory" },
        "/project/android/app/build/outputs/bundle/release/app.aab": {
          type: "File",
          mtimeMs: 1234,
        },
      });
      const result = yield* findAndroidArtifact({
        projectRoot: "/project",
        format: "aab",
        buildType: "release",
      }).pipe(Effect.provide(fs));
      expect(result).toBe("/project/android/app/build/outputs/bundle/release/app.aab");
    }),
  );

  it.effect("finds .apk at expected Gradle output path with flavor", () =>
    Effect.gen(function* () {
      const fs = makeFakeFs({
        "/p/android/app/build/outputs": { type: "Directory" },
        "/p/android/app/build/outputs/apk": { type: "Directory" },
        "/p/android/app/build/outputs/apk/prodRelease": { type: "Directory" },
        "/p/android/app/build/outputs/apk/prodRelease/app-prod-release.apk": {
          type: "File",
          mtimeMs: 100,
        },
      });
      const result = yield* findAndroidArtifact({
        projectRoot: "/p",
        format: "apk",
        flavor: "prod",
        buildType: "release",
      }).pipe(Effect.provide(fs));
      expect(result).toBe("/p/android/app/build/outputs/apk/prodRelease/app-prod-release.apk");
    }),
  );

  it.effect("falls back to walking outputs tree when expected dir missing", () =>
    Effect.gen(function* () {
      const fs = makeFakeFs({
        "/p/android/app/build/outputs": { type: "Directory" },
        "/p/android/app/build/outputs/bundle": { type: "Directory" },
        "/p/android/app/build/outputs/bundle/somewhere-else": { type: "Directory" },
        "/p/android/app/build/outputs/bundle/somewhere-else/fallback.aab": {
          type: "File",
          mtimeMs: 500,
        },
      });
      const result = yield* findAndroidArtifact({
        projectRoot: "/p",
        format: "aab",
        buildType: "release",
      }).pipe(Effect.provide(fs));
      expect(result).toBe("/p/android/app/build/outputs/bundle/somewhere-else/fallback.aab");
    }),
  );

  it.effect("fails with ArtifactNotFoundError when nothing matches", () =>
    Effect.gen(function* () {
      const fs = makeFakeFs({
        "/p/android/app/build/outputs": { type: "Directory" },
      });
      const exit = yield* findAndroidArtifact({
        projectRoot: "/p",
        format: "aab",
        buildType: "release",
      }).pipe(Effect.provide(fs), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(ArtifactNotFoundError);
      }
    }),
  );
});
