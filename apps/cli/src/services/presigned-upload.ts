import { FileSystem, HttpClient, HttpClientRequest } from "@effect/platform";
import { Context, Effect, Layer } from "effect";

import { PresignedUrlExpiredError, UploadFailedError } from "../lib/exit-codes";

const EXPIRY_SAFETY_MARGIN_MS = 30_000;

export interface PutToPresignedUrlInput {
  readonly url: string;
  readonly filePath: string;
  readonly byteSize: number;
  readonly expiresAt: string;
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
      putToPresignedUrl: ({ url, filePath, byteSize, expiresAt }: PutToPresignedUrlInput) =>
        Effect.gen(function* () {
          const now = Date.now();
          const expiryMs = new Date(expiresAt).getTime();
          if (Number.isNaN(expiryMs) || now > expiryMs - EXPIRY_SAFETY_MARGIN_MS) {
            return yield* new PresignedUrlExpiredError({
              message: `Presigned upload URL expired or too close to expiry (expiresAt=${expiresAt}).`,
            });
          }

          const request = yield* HttpClientRequest.put(url).pipe(
            HttpClientRequest.setHeaders({
              "Content-Type": "application/octet-stream",
              "Content-Length": String(byteSize),
            }),
            HttpClientRequest.bodyFile(filePath),
            Effect.provideService(FileSystem.FileSystem, fileSystem),
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
        }),
    };
  }),
);
