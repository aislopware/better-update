import { Effect } from "effect";

import { formatCause } from "../../lib/format-error";
import { sha256File } from "../../lib/sha256";
import { printWarn } from "../../lib/warning-style";
import { PresignedUploadClient } from "../../services/presigned-upload";

import type { CapturedDebugArtifact } from "../../lib/debug-artifacts";
import type { OutputMode } from "../../lib/output-mode";
import type { ApiClient } from "../../services/api-client";

const uploadOne = (api: ApiClient, buildId: string, artifact: CapturedDebugArtifact) =>
  Effect.gen(function* () {
    const presignedUploadClient = yield* PresignedUploadClient;
    const { sha256, byteSize } = yield* sha256File(artifact.path);

    const reservation = yield* api.builds.reserveDebugArtifact({
      path: { id: buildId },
      payload: { type: artifact.type, sha256, byteSize },
    });

    yield* presignedUploadClient.putToPresignedUrl({
      url: reservation.uploadUrl,
      filePath: artifact.path,
      byteSize,
      expiresAt: reservation.uploadExpiresAt,
      headers: reservation.uploadHeaders,
    });

    yield* api.builds.completeDebugArtifact({
      path: { id: buildId },
      payload: { type: artifact.type, sha256, byteSize },
    });
  });

/**
 * Upload the captured crash-symbolication files for a completed build.
 * Best-effort by design: each artifact is attempted independently and a
 * failure only prints a warning — symbols are a debugging aid, so they must
 * never fail a build whose artifact already uploaded fine. Returns the types
 * that were actually stored.
 */
export const uploadDebugArtifacts = (
  api: ApiClient,
  params: {
    readonly buildId: string;
    readonly artifacts: readonly CapturedDebugArtifact[];
  },
): Effect.Effect<
  readonly CapturedDebugArtifact["type"][],
  never,
  PresignedUploadClient | OutputMode
> =>
  Effect.gen(function* () {
    const uploaded = yield* Effect.forEach(
      params.artifacts,
      (artifact) =>
        uploadOne(api, params.buildId, artifact).pipe(
          Effect.as<CapturedDebugArtifact["type"] | null>(artifact.type),
          Effect.catchAll((cause) =>
            printWarn(
              `Failed to store ${artifact.type} debug artifact: ${formatCause(cause)}`,
            ).pipe(Effect.as(null)),
          ),
        ),
      { concurrency: 1 },
    );
    return uploaded.filter((type): type is CapturedDebugArtifact["type"] => type !== null);
  });
