import { UpdateSourcemap } from "@better-update/api";
import { Effect, Schema } from "effect";

import type { CompleteSourcemapBody, ReserveSourcemapBody } from "@better-update/api";

import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertProjectOwnership } from "../auth/ownership";
import { assertAccess } from "../auth/policy";
import { BuildRuntime } from "../cloudflare/build-runtime";
import { createDirectUploadHeaders } from "../cloudflare/signed-url";
import { BadRequest, NotFound } from "../errors";
import { toApiBadRequestReadEffect } from "../http/to-api-effect";
import { BranchRepo, DebugArtifactRepo, UpdateRepo } from "../repositories";
import {
  completionMatchesReservation,
  DOWNLOAD_EXPIRY_SECONDS,
  downloadExpiresAtIso,
  KV_RESERVATION_TTL,
  parseReservation,
  sha256HexToBase64,
  UPLOAD_EXPIRY_SECONDS,
  uploadExpiresAtIso,
} from "./upload-reservation";

import type { UpdateSourcemapModel } from "../debug-artifact-models";

const SOURCEMAP_CONTENT_TYPE = "application/json";

/**
 * Sourcemaps live in the PRIVATE builds bucket (never the public assets CDN —
 * a sourcemap reconstructs the original source) under a deterministic
 * per-update key, so re-publishing a sourcemap overwrites in place.
 */
export const updateSourcemapKey = (params: {
  readonly organizationId: string;
  readonly projectId: string;
  readonly updateId: string;
}) => `sourcemaps/${params.organizationId}/${params.projectId}/${params.updateId}.map`;

const sourcemapReservationId = (updateId: string) => `sourcemap:${updateId}`;

const SourcemapReservationSchema = Schema.Struct({
  r2Key: Schema.String,
  sha256: Schema.String,
  byteSize: Schema.Number,
});

const toApiSourcemap = (model: UpdateSourcemapModel) =>
  new UpdateSourcemap({
    updateId: model.updateId,
    byteSize: model.byteSize,
    sha256: model.sha256,
    createdAt: model.createdAt,
  });

/**
 * Resolve update → branch → project and gate the caller. `create` gates at
 * the branch environment (same scope as publishing the update itself);
 * `read` mirrors the other update read endpoints.
 */
const assertUpdateAccess = (updateId: string, action: "create" | "read") =>
  Effect.gen(function* () {
    const updateRepo = yield* UpdateRepo;
    const update = yield* updateRepo.findById({ id: updateId });
    const branchRepo = yield* BranchRepo;
    const branch = yield* branchRepo.findById({ id: update.branchId });
    yield* assertProjectOwnership(branch.projectId);
    yield* assertAccess("update", action, {
      kind: "environment",
      projectId: branch.projectId,
      environment: branch.name,
    });
    return { update, projectId: branch.projectId };
  });

export const handleReserveSourcemap = ({
  path,
  payload,
}: {
  readonly path: { readonly id: string };
  readonly payload: typeof ReserveSourcemapBody.Type;
}) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      const { projectId } = yield* assertUpdateAccess(path.id, "create");
      const ctx = yield* CurrentActor;
      const runtime = yield* BuildRuntime;

      const r2Key = updateSourcemapKey({
        organizationId: ctx.organizationId,
        projectId,
        updateId: path.id,
      });
      const checksumSha256Base64 = yield* sha256HexToBase64(payload.sha256, "Sourcemap");
      const uploadUrl = yield* runtime.createUploadUrl({
        key: r2Key,
        expiresIn: UPLOAD_EXPIRY_SECONDS,
        contentType: SOURCEMAP_CONTENT_TYPE,
        checksumSha256Base64,
      });

      yield* runtime.putReservation({
        id: sourcemapReservationId(path.id),
        value: JSON.stringify({
          r2Key,
          sha256: payload.sha256.toLowerCase(),
          byteSize: payload.byteSize,
        }),
        ttlSeconds: KV_RESERVATION_TTL,
      });

      return {
        uploadUrl,
        uploadExpiresAt: uploadExpiresAtIso(),
        uploadHeaders: createDirectUploadHeaders({
          checksumSha256Base64,
          contentType: SOURCEMAP_CONTENT_TYPE,
        }),
      };
    }),
  );

export const handleCompleteSourcemap = ({
  path,
  payload,
}: {
  readonly path: { readonly id: string };
  readonly payload: typeof CompleteSourcemapBody.Type;
}) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      const { projectId } = yield* assertUpdateAccess(path.id, "create");
      const runtime = yield* BuildRuntime;

      const reservationId = sourcemapReservationId(path.id);
      const reservationJson = yield* runtime.getReservation({ id: reservationId });
      if (!reservationJson) {
        return yield* new NotFound({ message: "Sourcemap reservation not found or expired" });
      }
      const reservation = yield* parseReservation(
        reservationJson,
        SourcemapReservationSchema,
        "Sourcemap reservation",
      );

      if (!completionMatchesReservation(payload, reservation)) {
        return yield* new BadRequest({
          message: "Sourcemap completion payload does not match the reservation",
        });
      }

      const repo = yield* DebugArtifactRepo;
      const sourcemap = yield* repo.upsertUpdateSourcemap({
        updateId: path.id,
        r2Key: reservation.r2Key,
        byteSize: reservation.byteSize,
        sha256: reservation.sha256,
      });

      yield* runtime.deleteReservation({ id: reservationId });

      yield* logAudit({
        action: "update.sourcemap.upload",
        resourceType: "update",
        resourceId: path.id,
        projectId,
      });

      return toApiSourcemap(sourcemap);
    }),
  );

export const handleGetSourcemap = ({ path }: { readonly path: { readonly id: string } }) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      yield* assertUpdateAccess(path.id, "read");
      const repo = yield* DebugArtifactRepo;
      const sourcemap = yield* repo.findSourcemapByUpdateId({ updateId: path.id });
      return sourcemap ? toApiSourcemap(sourcemap) : null;
    }),
  );

export const handleGetSourcemapDownload = ({ path }: { readonly path: { readonly id: string } }) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      yield* assertUpdateAccess(path.id, "read");
      const repo = yield* DebugArtifactRepo;
      const sourcemap = yield* repo.findSourcemapByUpdateId({ updateId: path.id });
      if (!sourcemap) {
        return yield* new NotFound({ message: `Update ${path.id} has no sourcemap` });
      }
      const runtime = yield* BuildRuntime;
      const url = yield* runtime.createDownloadUrl({
        key: sourcemap.r2Key,
        expiresIn: DOWNLOAD_EXPIRY_SECONDS,
        // Force a save dialog: a bare presigned URL would render the JSON map
        // as text when opened in a browser tab.
        contentDisposition: `attachment; filename="${path.id}.map"`,
      });
      return { url, expiresAt: downloadExpiresAtIso() };
    }),
  );
