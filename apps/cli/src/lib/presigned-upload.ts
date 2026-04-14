import { Effect } from "effect";

import { PresignedUploadClient } from "../services/presigned-upload";
import { PresignedUrlExpiredError, UploadFailedError } from "./exit-codes";

export interface PutToPresignedUrlOptions {
  readonly url: string;
  readonly filePath: string;
  readonly byteSize: number;
  readonly expiresAt: string;
}

export const putToPresignedUrl = ({
  url,
  filePath,
  byteSize,
  expiresAt,
}: PutToPresignedUrlOptions): Effect.Effect<
  void,
  PresignedUrlExpiredError | UploadFailedError,
  PresignedUploadClient
> =>
  Effect.gen(function* () {
    const presignedUploadClient = yield* PresignedUploadClient;
    yield* presignedUploadClient.putToPresignedUrl({
      url,
      filePath,
      byteSize,
      expiresAt,
    });
  });
