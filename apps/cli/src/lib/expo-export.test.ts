import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Effect, Exit } from "effect";

import { UpdatePublishError } from "./exit-codes";
import { findExportedSourcemap, readExpoExportAssets } from "./expo-export";
import { failureError } from "./test-utils";

const makeFs = (files: Record<string, string>) =>
  FileSystem.layerNoop({
    readFileString: (filePath: string) => {
      const value = files[filePath];
      return value === undefined
        ? Effect.die(new Error(`ENOENT: ${filePath}`))
        : Effect.succeed(value);
    },
  });

describe(readExpoExportAssets, () => {
  it("parses launch bundle and regular assets from metadata.json", async () => {
    const exportDir = "/tmp/export-ios";
    const metadataPath = path.join(exportDir, "metadata.json");
    const exit = await Effect.runPromiseExit(
      readExpoExportAssets({ exportDir, platform: "ios" }).pipe(
        Effect.provide(
          makeFs({
            [metadataPath]: JSON.stringify({
              version: 0,
              bundler: "metro",
              fileMetadata: {
                ios: {
                  bundle: "_expo/static/js/ios/index-ba7f80c877854ce4d715c0cb029ac497.hbc",
                  assets: [{ path: "assets/4e3f888fc8475f69fd5fa32f1ad5216a", ext: "png" }],
                },
              },
            }),
          }),
        ),
      ),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toStrictEqual([
        {
          path: path.join(
            exportDir,
            "_expo/static/js/ios/index-ba7f80c877854ce4d715c0cb029ac497.hbc",
          ),
          key: "index-ba7f80c877854ce4d715c0cb029ac497.hbc",
          fileExt: "hbc",
          contentType: "application/javascript",
          isLaunch: true,
        },
        {
          path: path.join(exportDir, "assets/4e3f888fc8475f69fd5fa32f1ad5216a"),
          key: "4e3f888fc8475f69fd5fa32f1ad5216a",
          fileExt: "png",
          contentType: "image/png",
          isLaunch: false,
        },
      ]);
    }
  });

  it("fails when the requested platform is missing from metadata", async () => {
    const exportDir = "/tmp/export-android";
    const metadataPath = path.join(exportDir, "metadata.json");
    const exit = await Effect.runPromiseExit(
      readExpoExportAssets({ exportDir, platform: "android" }).pipe(
        Effect.provide(
          makeFs({
            [metadataPath]: JSON.stringify({
              version: 0,
              bundler: "metro",
              fileMetadata: {
                ios: {
                  bundle: "_expo/static/js/ios/index.hbc",
                  assets: [],
                },
              },
            }),
          }),
        ),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(failureError(exit)).toBeInstanceOf(UpdatePublishError);
    }
  });
});

const makeSourcemapFs = (params: { readonly existing: readonly string[] }) =>
  FileSystem.layerNoop({
    exists: (filePath: string) => Effect.succeed(params.existing.includes(filePath)),
  });

describe(findExportedSourcemap, () => {
  const bundlePath = "/tmp/export-ios/_expo/static/js/ios/index-abc123.hbc";
  const bundleDir = path.dirname(bundlePath);

  it("prefers the <bundle>.map sibling", async () => {
    const result = await Effect.runPromise(
      findExportedSourcemap({ bundlePath }).pipe(
        Effect.provide(makeSourcemapFs({ existing: [`${bundlePath}.map`] })),
      ),
    );
    expect(result).toBe(`${bundlePath}.map`);
  });

  it("falls back to the bundle path with its extension swapped for .map", async () => {
    const swapped = path.join(bundleDir, "index-abc123.map");
    const result = await Effect.runPromise(
      findExportedSourcemap({ bundlePath }).pipe(
        Effect.provide(makeSourcemapFs({ existing: [swapped] })),
      ),
    );
    expect(result).toBe(swapped);
  });

  it("ignores unrelated .map files next to the bundle (stale maps from reused export dirs)", async () => {
    const result = await Effect.runPromise(
      findExportedSourcemap({ bundlePath }).pipe(
        Effect.provide(makeSourcemapFs({ existing: [path.join(bundleDir, "other-bundle.map")] })),
      ),
    );
    expect(result).toBeNull();
  });

  it("returns null when the export produced no map", async () => {
    const result = await Effect.runPromise(
      findExportedSourcemap({ bundlePath }).pipe(Effect.provide(makeSourcemapFs({ existing: [] }))),
    );
    expect(result).toBeNull();
  });
});
