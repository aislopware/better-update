import { Effect } from "effect";

import { CompleteError, ReserveError } from "../../lib/exit-codes";
import { formatCause } from "../../lib/format-error";
import { PresignedUploadClient } from "../../services/presigned-upload";

import type { PresignedUrlExpiredError, UploadFailedError } from "../../lib/exit-codes";
import type { ApiClient } from "../../services/api-client";

export type BuildTarget =
  | {
      readonly platform: "ios";
      readonly distribution: "app-store" | "ad-hoc" | "development" | "enterprise";
      readonly artifactFormat: "ipa";
    }
  | {
      readonly platform: "ios";
      readonly distribution: "simulator";
      readonly artifactFormat: "tar.gz";
    }
  | {
      readonly platform: "android";
      readonly distribution: "play-store";
      readonly artifactFormat: "aab";
    }
  | {
      readonly platform: "android";
      readonly distribution: "direct";
      readonly artifactFormat: "apk";
    };

export interface ReserveAndUploadInput {
  readonly target: BuildTarget;
  readonly projectId: string;
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
  readonly fingerprintHash?: string;
  readonly artifactPath: string;
  readonly sha256: string;
  readonly byteSize: number;
}

const buildReserveCommon = (input: ReserveAndUploadInput) =>
  ({
    projectId: input.projectId,
    profile: input.profileName,
    runtimeVersion: input.runtimeVersion,
    bundleId: input.bundleId,
    sha256: input.sha256,
    byteSize: input.byteSize,
    ...(input.appVersion === undefined ? {} : { appVersion: input.appVersion }),
    ...(input.buildNumber === undefined ? {} : { buildNumber: input.buildNumber }),
    ...(input.gitContext.ref === undefined ? {} : { gitRef: input.gitContext.ref }),
    ...(input.gitContext.commit === undefined ? {} : { gitCommit: input.gitContext.commit }),
    gitDirty: input.gitContext.dirty,
    ...(input.message === undefined ? {} : { message: input.message }),
    ...(input.fingerprintHash === undefined ? {} : { fingerprintHash: input.fingerprintHash }),
  }) as const;

const callReserve = (api: ApiClient, input: ReserveAndUploadInput) => {
  const common = buildReserveCommon(input);
  const { target } = input;
  if (target.platform === "ios") {
    return target.distribution === "simulator"
      ? api.builds.reserve({
          payload: {
            ...common,
            platform: "ios",
            distribution: "simulator",
            artifactFormat: "tar.gz",
          },
        })
      : api.builds.reserve({
          payload: {
            ...common,
            platform: "ios",
            distribution: target.distribution,
            artifactFormat: "ipa",
          },
        });
  }
  return target.distribution === "play-store"
    ? api.builds.reserve({
        payload: {
          ...common,
          platform: "android",
          distribution: "play-store",
          artifactFormat: "aab",
        },
      })
    : api.builds.reserve({
        payload: { ...common, platform: "android", distribution: "direct", artifactFormat: "apk" },
      });
};

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

    const reserveResult = yield* callReserve(api, input).pipe(
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
      headers: reserveResult.uploadHeaders,
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
