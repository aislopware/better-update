import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Effect, Exit } from "effect";

import { UpdatePublishError } from "./exit-codes";
import { readExpoExportAssets } from "./expo-export";
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
