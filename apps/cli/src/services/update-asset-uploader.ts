import { Context, Effect, Layer } from "effect";

import { UpdatePublishError } from "../lib/exit-codes";
import { apiClient } from "./api-client";
import { PresignedUploadClient } from "./presigned-upload";

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

export interface UploadUpdateAssetInput {
  readonly path: string;
  readonly hash: string;
  readonly byteSize: number;
  readonly uploadUrl: string;
  readonly uploadExpiresAt: string;
  readonly uploadHeaders: Record<string, string>;
}

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
    const presignedUploadClient = yield* PresignedUploadClient;
    const api = yield* apiClient;

    return {
      uploadAssetBinary: (asset: UploadUpdateAssetInput) =>
        Effect.gen(function* () {
          yield* presignedUploadClient
            .putToPresignedUrl({
              url: asset.uploadUrl,
              filePath: asset.path,
              byteSize: asset.byteSize,
              expiresAt: asset.uploadExpiresAt,
              headers: asset.uploadHeaders,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new UpdatePublishError({
                    message: `Asset upload failed for ${asset.hash}: ${formatCause(cause)}`,
                  }),
              ),
            );

          yield* api.assets.finalize({ path: { hash: asset.hash } }).pipe(
            Effect.mapError(
              (cause) =>
                new UpdatePublishError({
                  message: `Asset finalize failed for ${asset.hash}: ${formatCause(cause)}`,
                }),
            ),
          );
        }),
    };
  }),
);
