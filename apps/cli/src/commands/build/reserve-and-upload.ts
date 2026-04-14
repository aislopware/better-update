import { Distribution } from "@better-update/api";
import { Effect, Schema } from "effect";

import { CompleteError, ReserveError } from "../../lib/exit-codes";
import { PresignedUploadClient } from "../../services/presigned-upload";

import type { PresignedUrlExpiredError, UploadFailedError } from "../../lib/exit-codes";
import type { ApiClient } from "../../services/api-client";

export type DistributionValue = Schema.Schema.Type<typeof Distribution>;

export interface ReserveAndUploadInput {
  readonly projectId: string;
  readonly platform: "ios" | "android";
  readonly distribution: DistributionValue;
  readonly artifactFormat: "ipa" | "apk" | "aab";
  readonly profileName: string;
  readonly runtimeVersion: string;
  readonly appVersion?: string;
  readonly buildNumber?: string;
  readonly bundleId: string;
  readonly gitContext: {
    readonly ref?: string;
    readonly commit?: string;
    readonly dirty: boolean;
  };
  readonly message?: string;
  readonly artifactPath: string;
  readonly sha256: string;
  readonly byteSize: number;
}

export interface ReserveAndUploadResult {
  readonly id: string;
  readonly status: string;
}

/**
 * Reserve a build record on the server, upload the artifact to the returned
 * presigned URL, and finalize the build with its sha256 + byteSize.
 */
export const reserveAndUpload = (
  api: ApiClient,
  input: ReserveAndUploadInput,
): Effect.Effect<
  ReserveAndUploadResult,
  ReserveError | UploadFailedError | PresignedUrlExpiredError | CompleteError,
  PresignedUploadClient
> =>
  Effect.gen(function* () {
    const presignedUploadClient = yield* PresignedUploadClient;

    const reserveResult = yield* api.builds
      .reserve({
        payload: {
          projectId: input.projectId,
          platform: input.platform,
          profile: input.profileName,
          distribution: input.distribution,
          artifactFormat: input.artifactFormat,
          runtimeVersion: input.runtimeVersion,
          ...(input.appVersion !== undefined ? { appVersion: input.appVersion } : {}),
          ...(input.buildNumber !== undefined ? { buildNumber: input.buildNumber } : {}),
          bundleId: input.bundleId,
          ...(input.gitContext.ref !== undefined ? { gitRef: input.gitContext.ref } : {}),
          ...(input.gitContext.commit !== undefined ? { gitCommit: input.gitContext.commit } : {}),
          ...(input.message !== undefined ? { message: input.message } : {}),
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ReserveError({
              message: `Failed to reserve build: ${formatCause(cause)}`,
            }),
        ),
      );

    yield* presignedUploadClient.putToPresignedUrl({
      url: reserveResult.uploadUrl,
      filePath: input.artifactPath,
      byteSize: input.byteSize,
      expiresAt: reserveResult.uploadExpiresAt,
    });

    const completed = yield* api.builds
      .complete({
        path: { id: reserveResult.id },
        payload: { sha256: input.sha256, byteSize: input.byteSize },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CompleteError({
              message: `Failed to complete build ${reserveResult.id}: ${formatCause(cause)}`,
            }),
        ),
      );

    if (!completed.artifact) {
      return yield* new CompleteError({
        message: `Build ${completed.id} completed but server returned no artifact record.`,
      });
    }

    return { id: completed.id, status: "uploaded" };
  });

const formatCause = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "object" && cause !== null) {
    const tagged = cause as { readonly _tag?: unknown; readonly message?: unknown };
    const tag = typeof tagged._tag === "string" ? tagged._tag : undefined;
    const msg = typeof tagged.message === "string" ? tagged.message : undefined;
    if (tag && msg) return `${tag}: ${msg}`;
    if (tag) return tag;
    if (msg) return msg;
  }
  return String(cause);
};
