import { BuildDebugArtifact } from "@better-update/api";
import { Effect, Schema } from "effect";

import type {
  CompleteDebugArtifactBody,
  DebugArtifactType as ApiDebugArtifactType,
  ReserveDebugArtifactBody,
} from "@better-update/api";

import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertProjectOwnership } from "../auth/ownership";
import { assertAccess } from "../auth/policy";
import { BuildRuntime } from "../cloudflare/build-runtime";
import { createDirectUploadHeaders } from "../cloudflare/signed-url";
import { BadRequest, NotFound } from "../errors";
import { toApiBadRequestReadEffect } from "../http/to-api-effect";
import { BuildRepo, DebugArtifactRepo } from "../repositories";
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

import type { BuildDebugArtifactModel, DebugArtifactType } from "../debug-artifact-models";

/** File extension + content type per debug artifact kind. */
const DEBUG_ARTIFACT_FILE = {
  dsym: { ext: "zip", contentType: "application/zip" },
  "js-sourcemap": { ext: "map", contentType: "application/json" },
  "proguard-mapping": { ext: "txt", contentType: "text/plain" },
  "native-symbols": { ext: "zip", contentType: "application/zip" },
} as const satisfies Record<DebugArtifactType, { ext: string; contentType: string }>;

export const debugArtifactContentType = (type: DebugArtifactType): string =>
  DEBUG_ARTIFACT_FILE[type].contentType;

/**
 * Deterministic per-(build, type) key under the private builds bucket. NEVER
 * the public assets CDN bucket — sourcemaps and symbol files reveal original
 * source and must only leave the server via short-lived presigned GET URLs.
 */
export const debugArtifactKey = (params: {
  readonly organizationId: string;
  readonly projectId: string;
  readonly buildId: string;
  readonly type: DebugArtifactType;
}) =>
  `builds/${params.organizationId}/${params.projectId}/${params.buildId}/debug/${params.type}.${DEBUG_ARTIFACT_FILE[params.type].ext}`;

const debugReservationId = (buildId: string, type: DebugArtifactType) => `debug:${buildId}:${type}`;

const DebugReservationSchema = Schema.Struct({
  r2Key: Schema.String,
  contentType: Schema.String,
  sha256: Schema.String,
  byteSize: Schema.Number,
  checksumSha256Base64: Schema.String,
});

const toApiDebugArtifact = (model: BuildDebugArtifactModel) =>
  new BuildDebugArtifact({
    buildId: model.buildId,
    type: model.type,
    contentType: model.contentType,
    byteSize: model.byteSize,
    sha256: model.sha256,
    createdAt: model.createdAt,
  });

/** Load the build and gate the caller (`build` action on the owning project). */
const assertBuildAccess = (buildId: string, action: "create" | "read") =>
  Effect.gen(function* () {
    const repo = yield* BuildRepo;
    const build = yield* repo.findById({ id: buildId });
    yield* assertProjectOwnership(build.projectId);
    yield* assertAccess("build", action, {
      kind: "build",
      projectId: build.projectId,
      buildId,
    });
    return build;
  });

export const handleReserveDebugArtifact = ({
  path,
  payload,
}: {
  readonly path: { readonly id: string };
  readonly payload: typeof ReserveDebugArtifactBody.Type;
}) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      const build = yield* assertBuildAccess(path.id, "create");
      const ctx = yield* CurrentActor;
      const runtime = yield* BuildRuntime;

      const r2Key = debugArtifactKey({
        organizationId: ctx.organizationId,
        projectId: build.projectId,
        buildId: path.id,
        type: payload.type,
      });
      const contentType = debugArtifactContentType(payload.type);
      const checksumSha256Base64 = yield* sha256HexToBase64(payload.sha256, "Debug artifact");
      const uploadUrl = yield* runtime.createUploadUrl({
        key: r2Key,
        expiresIn: UPLOAD_EXPIRY_SECONDS,
        contentType,
        checksumSha256Base64,
      });

      yield* runtime.putReservation({
        id: debugReservationId(path.id, payload.type),
        value: JSON.stringify({
          r2Key,
          contentType,
          sha256: payload.sha256.toLowerCase(),
          byteSize: payload.byteSize,
          checksumSha256Base64,
        }),
        ttlSeconds: KV_RESERVATION_TTL,
      });

      return {
        uploadUrl,
        uploadExpiresAt: uploadExpiresAtIso(),
        uploadHeaders: createDirectUploadHeaders({ checksumSha256Base64, contentType }),
      };
    }),
  );

export const handleCompleteDebugArtifact = ({
  path,
  payload,
}: {
  readonly path: { readonly id: string };
  readonly payload: typeof CompleteDebugArtifactBody.Type;
}) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      const build = yield* assertBuildAccess(path.id, "create");
      const runtime = yield* BuildRuntime;

      const reservationId = debugReservationId(path.id, payload.type);
      const reservationJson = yield* runtime.getReservation({ id: reservationId });
      if (!reservationJson) {
        return yield* new NotFound({
          message: "Debug artifact reservation not found or expired",
        });
      }
      const reservation = yield* parseReservation(
        reservationJson,
        DebugReservationSchema,
        "Debug artifact reservation",
      );

      if (!completionMatchesReservation(payload, reservation)) {
        return yield* new BadRequest({
          message: "Debug artifact completion payload does not match the reservation",
        });
      }

      const repo = yield* DebugArtifactRepo;
      const artifact = yield* repo.upsertBuildArtifact({
        buildId: path.id,
        type: payload.type,
        r2Key: reservation.r2Key,
        contentType: reservation.contentType,
        byteSize: reservation.byteSize,
        sha256: reservation.sha256,
      });

      yield* runtime.deleteReservation({ id: reservationId });

      yield* logAudit({
        action: "build.debug_artifact.upload",
        resourceType: "build",
        resourceId: path.id,
        projectId: build.projectId,
        metadata: { type: payload.type },
      });

      return toApiDebugArtifact(artifact);
    }),
  );

export const handleListDebugArtifacts = ({ path }: { readonly path: { readonly id: string } }) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      yield* assertBuildAccess(path.id, "read");
      const repo = yield* DebugArtifactRepo;
      const items = yield* repo.listByBuildId({ buildId: path.id });
      return { items: items.map(toApiDebugArtifact) };
    }),
  );

export const handleGetDebugArtifactDownload = ({
  path,
}: {
  readonly path: { readonly id: string; readonly type: typeof ApiDebugArtifactType.Type };
}) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      yield* assertBuildAccess(path.id, "read");
      const repo = yield* DebugArtifactRepo;
      const artifact = yield* repo.findByBuildIdAndType({ buildId: path.id, type: path.type });
      if (!artifact) {
        return yield* new NotFound({
          message: `Build ${path.id} has no ${path.type} debug artifact`,
        });
      }
      const runtime = yield* BuildRuntime;
      const url = yield* runtime.createDownloadUrl({
        key: artifact.r2Key,
        expiresIn: DOWNLOAD_EXPIRY_SECONDS,
        // Force a save dialog: without this, sourcemaps/mappings render as raw
        // text when the presigned URL is opened in a browser tab.
        contentDisposition: `attachment; filename="${path.id}-${path.type}.${DEBUG_ARTIFACT_FILE[path.type].ext}"`,
      });
      return { url, expiresAt: downloadExpiresAtIso() };
    }),
  );
