import { FileSystem, HttpClient, HttpClientRequest } from "@effect/platform";
import { Context, Effect, Layer } from "effect";

import { PresignedUrlExpiredError, UploadFailedError } from "../lib/exit-codes";

const EXPIRY_SAFETY_MARGIN_MS = 30_000;

export interface PutToPresignedUrlInput {
  readonly url: string;
  readonly filePath: string;
  readonly byteSize: number;
  readonly expiresAt: string;
  readonly headers?: Record<string, string>;
}

export class PresignedUploadClient extends Context.Tag("cli/PresignedUploadClient")<
  PresignedUploadClient,
  {
    readonly putToPresignedUrl: (
      input: PutToPresignedUrlInput,
    ) => Effect.Effect<void, PresignedUrlExpiredError | UploadFailedError>;
  }
>() {}

export const PresignedUploadClientLive = Layer.effect(
  PresignedUploadClient,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const fileSystem = yield* FileSystem.FileSystem;

    return {
      putToPresignedUrl: ({
        url,
        filePath,
        byteSize,
        expiresAt,
        headers,
      }: PutToPresignedUrlInput) =>
        Effect.gen(function* () {
          const now = Date.now();
          const expiryMs = new Date(expiresAt).getTime();
          if (Number.isNaN(expiryMs) || now > expiryMs - EXPIRY_SAFETY_MARGIN_MS) {
            return yield* new PresignedUrlExpiredError({
              message: `Presigned upload URL expired or too close to expiry (expiresAt=${expiresAt}).`,
            });
          }

          // R2 presigned PUTs require Content-Length. `bodyFile` makes the
          // fetch-based client send a streaming body, so fetch falls back to
          // chunked transfer-encoding and drops the (forbidden-to-set)
          // content-length header -> R2 returns 411 MissingContentLength. Read
          // the artifact into a Uint8Array instead: it has a known size, so
          // fetch emits Content-Length itself and the explicit header survives.
          const bytes = yield* fileSystem.readFile(filePath).pipe(
            Effect.mapError(
              (cause) =>
                new UploadFailedError({
                  message: `Failed to read artifact for upload: ${String(cause)}`,
                }),
            ),
          );

          const request = HttpClientRequest.put(url).pipe(
            HttpClientRequest.bodyUint8Array(bytes),
            HttpClientRequest.setHeaders({
              "content-length": String(byteSize),
              ...headers,
            }),
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
          return undefined;
        }),
    };
  }),
);
