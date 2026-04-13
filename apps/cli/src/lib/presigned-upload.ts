import { FileSystem, HttpClient, HttpClientRequest } from "@effect/platform";
import { Effect } from "effect";

import { PresignedUrlExpiredError, UploadFailedError } from "./exit-codes";

export interface PutToPresignedUrlOptions {
  readonly url: string;
  readonly filePath: string;
  readonly byteSize: number;
  readonly expiresAt: string;
}

const EXPIRY_SAFETY_MARGIN_MS = 30_000;

/**
 * Upload a file to a presigned URL via HTTP PUT. Streams the body from disk
 * using `HttpClientRequest.bodyFile` to avoid loading the entire artifact into
 * memory.
 *
 * Callers are expected to provide `FetchHttpClient.layer` (or a stub) for
 * `HttpClient.HttpClient`, plus a `FileSystem.FileSystem`. The orchestrator
 * composes these layers at the edge of the program.
 */
export const putToPresignedUrl = ({
  url,
  filePath,
  byteSize,
  expiresAt,
}: PutToPresignedUrlOptions): Effect.Effect<
  void,
  PresignedUrlExpiredError | UploadFailedError,
  HttpClient.HttpClient | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    // Pre-flight expiry check with 30 s safety margin.
    const now = Date.now();
    const expiryMs = new Date(expiresAt).getTime();
    if (Number.isNaN(expiryMs) || now > expiryMs - EXPIRY_SAFETY_MARGIN_MS) {
      return yield* new PresignedUrlExpiredError({
        message: `Presigned upload URL expired or too close to expiry (expiresAt=${expiresAt}).`,
      });
    }

    const client = yield* HttpClient.HttpClient;

    const request = yield* HttpClientRequest.put(url).pipe(
      HttpClientRequest.setHeaders({
        "Content-Type": "application/octet-stream",
        "Content-Length": String(byteSize),
      }),
      HttpClientRequest.bodyFile(filePath),
      Effect.mapError(
        (cause) =>
          new UploadFailedError({
            message: `Failed to open artifact for upload: ${String(cause)}`,
          }),
      ),
    );

    const response = yield* client.execute(request).pipe(
      Effect.mapError(
        (cause) =>
          new UploadFailedError({
            message: `HTTP request to presigned URL failed: ${String(cause)}`,
          }),
      ),
    );

    if (response.status < 200 || response.status >= 300) {
      const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
      return yield* new UploadFailedError({
        message: `Presigned URL upload failed with status ${response.status}: ${body}`,
      });
    }
  });
