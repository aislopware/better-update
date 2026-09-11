import { Effect, Schema } from "effect";

import type { CompleteInstallArtifactBody, ReserveInstallArtifactBody } from "@better-update/api";

import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertProjectOwnership } from "../auth/ownership";
import { assertAccess } from "../auth/policy";
import { BuildRuntime } from "../cloudflare/build-runtime";
import { createDirectUploadHeaders } from "../cloudflare/signed-url";
import { BadRequest, NotFound } from "../errors";
import { toApiBadRequestReadEffect } from "../http/to-api-effect";
import { BuildRepo, InstallArtifactRepo } from "../repositories";
import {
  completionMatchesReservation,
  KV_RESERVATION_TTL,
  parseReservation,
  sha256HexToBase64,
  UPLOAD_EXPIRY_SECONDS,
  uploadExpiresAtIso,
} from "./upload-reservation";

export const INSTALL_ARTIFACT_CONTENT_TYPE = "application/vnd.android.package-archive";

/**
 * Deterministic per-build key beside the primary artifact
 * (`builds/{org}/{project}/{buildId}.aab`), so a browser download of the
 * presigned URL lands as `<buildId>.universal.apk` without a disposition header.
 */
export const installArtifactKey = (params: {
  readonly organizationId: string;
  readonly projectId: string;
  readonly buildId: string;
}) => `builds/${params.organizationId}/${params.projectId}/${params.buildId}.universal.apk`;

const installReservationId = (buildId: string) => `install:${buildId}`;

const InstallReservationSchema = Schema.Struct({
  r2Key: Schema.String,
  sha256: Schema.String,
  byteSize: Schema.Number,
  checksumSha256Base64: Schema.String,
});

/**
 * Load the build and gate the caller (`build` action on the owning project).
 * Only an Android App Bundle can carry an install artifact — an `.apk` build
 * is already installable and an iOS build has nothing an APK could add.
 */
const assertAabBuildAccess = (buildId: string) =>
  Effect.gen(function* () {
    const repo = yield* BuildRepo;
    const build = yield* repo.findById({ id: buildId });
    yield* assertProjectOwnership(build.projectId);
    yield* assertAccess("build", "create", {
      kind: "build",
      projectId: build.projectId,
      buildId,
    });
    if (build.platform !== "android" || build.artifact?.format !== "aab") {
      return yield* new BadRequest({
        message: "Only Android App Bundle (aab) builds accept a universal APK install artifact",
      });
    }
    return build;
  });

export const handleReserveInstallArtifact = ({
  params,
  payload,
}: {
  readonly params: { readonly id: string };
  readonly payload: typeof ReserveInstallArtifactBody.Type;
}) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      const build = yield* assertAabBuildAccess(params.id);
      const ctx = yield* CurrentActor;
      const runtime = yield* BuildRuntime;

      const r2Key = installArtifactKey({
        organizationId: ctx.organizationId,
        projectId: build.projectId,
        buildId: params.id,
      });
      const checksumSha256Base64 = yield* sha256HexToBase64(payload.sha256, "Install artifact");
      const uploadUrl = yield* runtime.createUploadUrl({
        key: r2Key,
        expiresIn: UPLOAD_EXPIRY_SECONDS,
        contentType: INSTALL_ARTIFACT_CONTENT_TYPE,
        checksumSha256Base64,
      });

      yield* runtime.putReservation({
        id: installReservationId(params.id),
        value: JSON.stringify({
          r2Key,
          sha256: payload.sha256.toLowerCase(),
          byteSize: payload.byteSize,
          checksumSha256Base64,
        }),
        ttlSeconds: KV_RESERVATION_TTL,
      });

      return {
        uploadUrl,
        uploadExpiresAt: uploadExpiresAtIso(),
        uploadHeaders: createDirectUploadHeaders({
          checksumSha256Base64,
          contentType: INSTALL_ARTIFACT_CONTENT_TYPE,
        }),
      };
    }),
  );

export const handleCompleteInstallArtifact = ({
  params,
  payload,
}: {
  readonly params: { readonly id: string };
  readonly payload: typeof CompleteInstallArtifactBody.Type;
}) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      const build = yield* assertAabBuildAccess(params.id);
      const runtime = yield* BuildRuntime;

      const reservationId = installReservationId(params.id);
      const reservationJson = yield* runtime.getReservation({ id: reservationId });
      if (!reservationJson) {
        return yield* new NotFound({
          message: "Install artifact reservation not found or expired",
        });
      }
      const reservation = yield* parseReservation(
        reservationJson,
        InstallReservationSchema,
        "Install artifact reservation",
      );

      if (!completionMatchesReservation(payload, reservation)) {
        return yield* new BadRequest({
          message: "Install artifact completion payload does not match the reservation",
        });
      }

      // No server-side R2 head/sha verification: R2 enforces the
      // x-amz-checksum-sha256 bound into the presigned PUT, so a successful
      // upload already proves the stored bytes (same trust model as builds).
      const repo = yield* InstallArtifactRepo;
      const artifact = yield* repo.upsert({
        buildId: params.id,
        r2Key: reservation.r2Key,
        contentType: INSTALL_ARTIFACT_CONTENT_TYPE,
        byteSize: reservation.byteSize,
        sha256: reservation.sha256,
      });

      yield* runtime.deleteReservation({ id: reservationId });

      yield* logAudit({
        action: "build.install_artifact.upload",
        resourceType: "build",
        resourceId: params.id,
        projectId: build.projectId,
      });

      return { buildId: params.id, ...artifact };
    }),
  );
