/**
 * Sparkle binary deltas of a macOS build: the CLI makes each with Sparkle's
 * BinaryDelta from an older released version's bundle, signs it with the
 * release's EdDSA key, reserves an upload here, PUTs it straight to R2 and
 * completes it; the appcast then lists it in the build's item.
 */
import { toDbNull } from "@better-update/type-guards";
import { Effect, Schema } from "effect";

import type {
  CompleteSparkleDeltaBody,
  ReserveSparkleDeltaBody,
} from "@better-update/api/domain/desktop-release";

import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertProjectOwnership } from "../auth/ownership";
import { assertAccess } from "../auth/policy";
import { BuildRuntime } from "../cloudflare/build-runtime";
import { createDirectUploadHeaders } from "../cloudflare/signed-url";
import { BadRequest, NotFound } from "../errors";
import { toApiSparkleDelta } from "../http/to-api";
import { toApiBadRequestReadEffect, toApiWriteEffect } from "../http/to-api-effect";
import { BuildRepo } from "../repositories";
import { DesktopBuildDeltaRepo } from "../repositories/desktop-build-deltas";
import {
  completionMatchesReservation,
  KV_RESERVATION_TTL,
  parseReservation,
  sha256HexToBase64,
  UPLOAD_EXPIRY_SECONDS,
  uploadExpiresAtIso,
} from "./upload-reservation";

const DELTA_CONTENT_TYPE = "application/octet-stream";

/** Archives Sparkle replaces an app bundle from; an installer package has no bundle to patch. */
const DELTA_FORMATS: ReadonlySet<string> = new Set(["zip", "tar.gz", "dmg"]);

const deltaReservationId = (buildId: string, deltaFrom: string) =>
  `sparkle-delta:${buildId}:${deltaFrom}`;

const DeltaReservationSchema = Schema.Struct({
  id: Schema.String,
  r2Key: Schema.String,
  sha256: Schema.String,
  byteSize: Schema.Number,
  edSignature: Schema.String,
  sparkleExecutableSize: Schema.NullOr(Schema.Number),
  sparkleLocales: Schema.NullOr(Schema.String),
});

/**
 * Load the build and gate the caller: a delta patches to a macOS Developer ID
 * app bundle shipped as a zip, tar.gz or dmg.
 */
const requireDeltaBuild = (buildId: string, action: "read" | "create") =>
  Effect.gen(function* () {
    const build = yield* (yield* BuildRepo).findById({ id: buildId });
    yield* assertProjectOwnership(build.projectId);
    yield* assertAccess("build", action, { kind: "build", projectId: build.projectId, buildId });
    const { artifact } = build;
    if (
      build.platform !== "macos" ||
      build.distribution !== "developer-id" ||
      artifact === null ||
      !DELTA_FORMATS.has(artifact.format)
    ) {
      return yield* new BadRequest({
        message:
          "Only a macOS Developer ID build shipped as a .zip, .tar.gz or .dmg takes Sparkle deltas",
      });
    }
    return { ...build, artifact };
  });

export const handleListSparkleDeltas = ({ params }: { readonly params: { readonly id: string } }) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      yield* requireDeltaBuild(params.id, "read");
      const deltas = yield* (yield* DesktopBuildDeltaRepo).listByBuilds({ buildIds: [params.id] });
      return { items: deltas.map(toApiSparkleDelta) };
    }),
  );

export const handleReserveSparkleDelta = ({
  params,
  payload,
}: {
  readonly params: { readonly id: string };
  readonly payload: typeof ReserveSparkleDeltaBody.Type;
}) =>
  toApiWriteEffect(
    Effect.gen(function* () {
      const build = yield* requireDeltaBuild(params.id, "create");
      if (payload.deltaFrom === build.buildNumber) {
        return yield* new BadRequest({
          message: `A delta from ${payload.deltaFrom} to the same version patches nothing`,
        });
      }
      const ctx = yield* CurrentActor;
      const runtime = yield* BuildRuntime;
      const id = crypto.randomUUID();
      const r2Key = `builds/${ctx.organizationId}/${build.projectId}/${params.id}.delta-${id}`;
      const checksumSha256Base64 = yield* sha256HexToBase64(payload.sha256, "Sparkle delta");
      const uploadUrl = yield* runtime.createUploadUrl({
        key: r2Key,
        expiresIn: UPLOAD_EXPIRY_SECONDS,
        contentType: DELTA_CONTENT_TYPE,
        checksumSha256Base64,
      });
      yield* runtime.putReservation({
        id: deltaReservationId(params.id, payload.deltaFrom),
        value: JSON.stringify({
          id,
          r2Key,
          sha256: payload.sha256.toLowerCase(),
          byteSize: payload.byteSize,
          edSignature: payload.edSignature,
          sparkleExecutableSize: toDbNull(payload.sparkleExecutableSize),
          sparkleLocales: toDbNull(payload.sparkleLocales),
        }),
        ttlSeconds: KV_RESERVATION_TTL,
      });
      return {
        uploadUrl,
        uploadExpiresAt: uploadExpiresAtIso(),
        uploadHeaders: createDirectUploadHeaders({
          checksumSha256Base64,
          contentType: DELTA_CONTENT_TYPE,
        }),
      };
    }),
  );

export const handleCompleteSparkleDelta = ({
  params,
  payload,
}: {
  readonly params: { readonly id: string };
  readonly payload: typeof CompleteSparkleDeltaBody.Type;
}) =>
  toApiWriteEffect(
    Effect.gen(function* () {
      const build = yield* requireDeltaBuild(params.id, "create");
      const runtime = yield* BuildRuntime;
      const reservationId = deltaReservationId(params.id, payload.deltaFrom);
      const reservationJson = yield* runtime.getReservation({ id: reservationId });
      if (!reservationJson) {
        return yield* new NotFound({ message: "Sparkle delta reservation not found or expired" });
      }
      const reservation = yield* parseReservation(
        reservationJson,
        DeltaReservationSchema,
        "Sparkle delta reservation",
      );
      if (!completionMatchesReservation(payload, reservation)) {
        return yield* new BadRequest({
          message: "Sparkle delta completion payload does not match the reservation",
        });
      }
      // R2 enforces the reserved x-amz-checksum-sha256 on the presigned PUT, so
      // a successful upload already proves the stored bytes.
      const { delta, replacedR2Key } = yield* (yield* DesktopBuildDeltaRepo).upsert({
        id: reservation.id,
        buildId: params.id,
        deltaFrom: payload.deltaFrom,
        r2Key: reservation.r2Key,
        byteSize: reservation.byteSize,
        sha256: reservation.sha256,
        edSignature: reservation.edSignature,
        sparkleExecutableSize: reservation.sparkleExecutableSize,
        sparkleLocales: reservation.sparkleLocales,
        now: new Date().toISOString(),
      });
      yield* runtime.deleteReservation({ id: reservationId });
      if (replacedR2Key !== null) {
        yield* runtime.deleteObjects({ keys: [replacedR2Key] });
      }
      yield* logAudit({
        action: "build.sparkle_delta.upload",
        resourceType: "build",
        resourceId: params.id,
        projectId: build.projectId,
        metadata: { deltaFrom: payload.deltaFrom, byteSize: reservation.byteSize },
      });
      return toApiSparkleDelta(delta);
    }),
  );
