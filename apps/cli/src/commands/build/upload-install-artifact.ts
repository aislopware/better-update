import { Effect } from "effect";

import { formatCause } from "../../lib/format-error";
import { printWarn } from "../../lib/warning-style";
import { PresignedUploadClient } from "../../services/presigned-upload";

import type { OutputMode } from "../../lib/output-mode";
import type { ApiClient } from "../../services/api-client";
import type { AndroidInstallArtifact } from "./android";

const uploadOne = (api: ApiClient, buildId: string, artifact: AndroidInstallArtifact) =>
  Effect.gen(function* () {
    const presignedUploadClient = yield* PresignedUploadClient;
    const { sha256, byteSize } = artifact;

    const reservation = yield* api.builds.reserveInstallArtifact({
      params: { id: buildId },
      payload: { sha256, byteSize },
    });

    yield* presignedUploadClient.putToPresignedUrl({
      url: reservation.uploadUrl,
      filePath: artifact.path,
      byteSize,
      expiresAt: reservation.uploadExpiresAt,
      headers: reservation.uploadHeaders,
    });

    yield* api.builds.completeInstallArtifact({
      params: { id: buildId },
      payload: { sha256, byteSize },
    });
  });

/**
 * Attach the universal APK to a completed `.aab` build. Best-effort by design:
 * the bundle already uploaded fine and is the deliverable — a failure here
 * only prints a warning and reports `false`, so the dashboard shows the build
 * without an install link rather than the CLI failing a finished build.
 */
export const uploadInstallArtifact = (
  api: ApiClient,
  params: {
    readonly buildId: string;
    readonly artifact: AndroidInstallArtifact;
  },
): Effect.Effect<boolean, never, PresignedUploadClient | OutputMode> =>
  uploadOne(api, params.buildId, params.artifact).pipe(
    Effect.as(true),
    Effect.catch((error) =>
      printWarn(`Failed to attach the universal APK: ${formatCause(error)}`).pipe(Effect.as(false)),
    ),
  );
