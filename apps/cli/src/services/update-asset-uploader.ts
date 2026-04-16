import { Context, Effect, Layer } from "effect";

import { UpdatePublishError } from "../lib/exit-codes";
import { formatCause } from "../lib/format-error";
import { apiClient } from "./api-client";
import { PresignedUploadClient } from "./presigned-upload";

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
