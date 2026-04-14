import { FileSystem, HttpClient, HttpClientRequest } from "@effect/platform";
import { Context, Effect, Layer } from "effect";

import { UpdatePublishError } from "../lib/exit-codes";
import { ConfigStore } from "./config-store";

export interface UploadUpdateAssetInput {
  readonly path: string;
  readonly hash: string;
  readonly uploadToken: string;
  readonly byteSize: number;
  readonly contentType: string;
}

const formatCause = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message;
  }

  if (typeof cause === "object" && cause !== null) {
    const tagged = cause as { readonly _tag?: unknown; readonly message?: unknown };
    const tag = typeof tagged._tag === "string" ? tagged._tag : undefined;
    const message = typeof tagged.message === "string" ? tagged.message : undefined;
    if (tag && message) return `${tag}: ${message}`;
    if (message) return message;
    if (tag) return tag;
  }

  return String(cause);
};

export class UpdateAssetUploader extends Context.Tag("cli/UpdateAssetUploader")<
  UpdateAssetUploader,
  {
    readonly uploadAssetBinary: (
      input: UploadUpdateAssetInput,
    ) => Effect.Effect<void, UpdatePublishError>;
  }
>() {}

export const UpdateAssetUploaderLive = Layer.effect(
  UpdateAssetUploader,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const fileSystem = yield* FileSystem.FileSystem;
    const configStore = yield* ConfigStore;

    return {
      uploadAssetBinary: (asset: UploadUpdateAssetInput) =>
        Effect.gen(function* () {
          const baseUrl = yield* configStore.getBaseUrl;
          const uploadUrl = new URL(`/api/assets/${encodeURIComponent(asset.hash)}`, baseUrl);

          const request = yield* HttpClientRequest.put(uploadUrl.toString()).pipe(
            HttpClientRequest.setHeaders({
              "X-Better-Update-Upload-Token": asset.uploadToken,
              "Content-Type": asset.contentType,
              "Content-Length": String(asset.byteSize),
            }),
            HttpClientRequest.bodyFile(asset.path),
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.mapError(
              (cause) =>
                new UpdatePublishError({
                  message: `Failed to read asset for upload: ${formatCause(cause)}`,
                }),
            ),
          );

          const response = yield* client.execute(request).pipe(
            Effect.mapError(
              (cause) =>
                new UpdatePublishError({
                  message: `Asset upload request failed: ${formatCause(cause)}`,
                }),
            ),
          );

          if (response.status < 200 || response.status >= 300) {
            const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
            return yield* new UpdatePublishError({
              message: `Asset upload failed with status ${String(response.status)}: ${body}`,
            });
          }
        }),
    };
  }),
);
