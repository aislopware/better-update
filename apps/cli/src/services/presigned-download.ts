import { createHash } from "node:crypto";

import { FileSystem, HttpClient, HttpClientRequest } from "@effect/platform";
import { Context, Effect, Layer } from "effect";

import { BaseDownloadError } from "../lib/exit-codes";
import { sha256Namespaced } from "../lib/sha256";

export interface DownloadToFileInput {
  /** Fully-qualified URL to GET the exact base bundle bytes. */
  readonly url: string;
  /** Where to write the downloaded bytes. */
  readonly outPath: string;
  /**
   * Expected namespaced launch-asset hash (the `launchAssetHash` from the
   * patch-base candidate, == the R2 `assets/{hash}` key the device fetches).
   * The base bytes MUST be byte-identical to what devices have; we recompute
   * the namespaced hash and verify rather than assume, so a CDN/route surprise
   * can never poison a patch. Launch bundles are always application/javascript.
   */
  readonly expectedLaunchAssetHash: string;
}

/** Launch bundles are always served as application/javascript (see expo-export). */
const LAUNCH_CONTENT_TYPE = "application/javascript";

export interface DownloadResult {
  readonly byteSize: number;
}

// GET analog of PresignedUploadClient. No CLI download path existed before the
// patch pipeline; this streams a URL body to a temp file and verifies its
// SHA-256 against the expected base launch-asset content hash.
export class PresignedDownloadClient extends Context.Tag("cli/PresignedDownloadClient")<
  PresignedDownloadClient,
  {
    readonly downloadToFile: (
      input: DownloadToFileInput,
    ) => Effect.Effect<DownloadResult, BaseDownloadError>;
  }
>() {}

export const PresignedDownloadClientLive = Layer.effect(
  PresignedDownloadClient,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const fileSystem = yield* FileSystem.FileSystem;

    return {
      downloadToFile: ({ url, outPath, expectedLaunchAssetHash }: DownloadToFileInput) =>
        Effect.gen(function* () {
          const response = yield* client
            .execute(HttpClientRequest.get(url))
            .pipe(
              Effect.mapError(
                (cause) =>
                  new BaseDownloadError({ message: `Base download failed: ${String(cause)}` }),
              ),
            );

          if (response.status < 200 || response.status >= 300) {
            return yield* new BaseDownloadError({
              message: `Base download failed with status ${response.status} for ${url}.`,
            });
          }

          const bytes = yield* response.arrayBuffer.pipe(
            Effect.mapError(
              (cause) =>
                new BaseDownloadError({
                  message: `Failed to read base download body: ${String(cause)}`,
                }),
            ),
          );
          const buffer = new Uint8Array(bytes);

          const contentSha256Hex = createHash("sha256").update(buffer).digest("hex");
          const actualLaunchHash = sha256Namespaced(LAUNCH_CONTENT_TYPE, contentSha256Hex);
          if (actualLaunchHash !== expectedLaunchAssetHash) {
            return yield* new BaseDownloadError({
              message: `Base bundle hash mismatch for ${url}: expected launch asset hash ${expectedLaunchAssetHash}, got ${actualLaunchHash}. Refusing to diff against non-identical base bytes.`,
            });
          }

          yield* fileSystem.writeFile(outPath, buffer).pipe(
            Effect.mapError(
              (cause) =>
                new BaseDownloadError({
                  message: `Failed to write base bundle to ${outPath}: ${String(cause)}`,
                }),
            ),
          );

          return { byteSize: buffer.byteLength } as const satisfies DownloadResult;
        }),
    };
  }),
);
