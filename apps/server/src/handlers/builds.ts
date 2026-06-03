import {
  ArtifactFormat,
  Distribution,
  INTERNAL_DISTRIBUTIONS,
  STORE_DISTRIBUTIONS,
} from "@better-update/api";
import { fromHex, toBase64 } from "@better-update/encoding";
import { HttpApiBuilder } from "@effect/platform";
import { Effect, Schema } from "effect";

import type { CompleteBuildBody, CreateBuildBody, BuildAudience } from "@better-update/api";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { BuildRuntime } from "../cloudflare/build-runtime";
import { cloudflareEnv } from "../cloudflare/context";
import { createDirectUploadHeaders } from "../cloudflare/signed-url";
import { generateInstallToken } from "../domain/install-token";
import { BadRequest, NotFound } from "../errors";
import { toApiBuild, toApiBuildCompatibilityMatrix } from "../http/to-api";
import { toApiBadRequestReadEffect } from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { parsePagination } from "../lib/pagination";
import { BuildRepo, CompatibilityRepo, ProjectRepo } from "../repositories";

import type { BuildSortKey, BuildSortOrder } from "../repositories/builds";

const parseBuildSort = (
  value: string | undefined = "-createdAt",
): { readonly sort: BuildSortKey; readonly order: BuildSortOrder } => {
  const order: BuildSortOrder = value.startsWith("-") ? "desc" : "asc";
  const column = value.startsWith("-") ? value.slice(1) : value;
  switch (column) {
    case "createdAt":
    case "platform":
    case "distribution":
    case "runtimeVersion":
    case "appVersion": {
      return { sort: column, order };
    }
    default: {
      return { sort: "createdAt", order: "desc" };
    }
  }
};

const UPLOAD_EXPIRY_SECONDS = 7200;
const KV_RESERVATION_TTL = 10_800;

const FORMAT_CONTENT_TYPES: Record<string, string> = {
  ipa: "application/octet-stream",
  apk: "application/vnd.android.package-archive",
  aab: "application/x-authorware-bin",
  "tar.gz": "application/gzip",
};

const formatForContentType = (format: string) =>
  FORMAT_CONTENT_TYPES[format] ?? "application/octet-stream";

const artifactExt = (format: string) => (format === "tar.gz" ? "tar.gz" : format);

const resolveAudience = (
  audience: typeof BuildAudience.Type | undefined,
): readonly (typeof Distribution.Type)[] | undefined => {
  if (audience === "internal") {
    return INTERNAL_DISTRIBUTIONS;
  }
  if (audience === "store") {
    return STORE_DISTRIBUTIONS;
  }
  return undefined;
};

const sha256HexToBase64 = (sha256: string) =>
  Effect.try({
    try: () => toBase64(fromHex(sha256)),
    catch: () => new BadRequest({ message: "Build SHA-256 must be valid hex" }),
  });

const ReservationSchema = Schema.Struct({
  buildId: Schema.String,
  projectId: Schema.String,
  platform: Schema.Literal("ios", "android"),
  profile: Schema.String,
  distribution: Distribution,
  artifactFormat: ArtifactFormat,
  runtimeVersion: Schema.NullOr(Schema.String),
  appVersion: Schema.NullOr(Schema.String),
  buildNumber: Schema.NullOr(Schema.String),
  bundleId: Schema.NullOr(Schema.String),
  gitRef: Schema.NullOr(Schema.String),
  gitCommit: Schema.NullOr(Schema.String),
  gitDirty: Schema.Boolean,
  message: Schema.NullOr(Schema.String),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  fingerprintHash: Schema.optionalWith(Schema.NullOr(Schema.String), { default: () => null }),
  sha256: Schema.String,
  byteSize: Schema.Number,
  checksumSha256Base64: Schema.String,
  r2Key: Schema.String,
  organizationId: Schema.String,
});

const decodeReservation = Schema.decodeUnknown(ReservationSchema);

const parseReservation = (json: string) =>
  Effect.gen(function* () {
    const raw = yield* Effect.try({
      try: () => JSON.parse(json) as unknown,
      catch: () => new BadRequest({ message: "Build reservation payload is not valid JSON" }),
    });
    return yield* decodeReservation(raw).pipe(
      Effect.mapError(
        () => new BadRequest({ message: "Build reservation payload failed schema decode" }),
      ),
    );
  });

const cleanupBuildObject = (key: string) =>
  Effect.gen(function* () {
    const runtime = yield* BuildRuntime;
    yield* runtime.deleteObjects({ keys: [key] });
  });

const buildArtifactKey = (params: {
  organizationId: string;
  projectId: string;
  buildId: string;
  artifactFormat: string;
}) =>
  `builds/${params.organizationId}/${params.projectId}/${params.buildId}.${artifactExt(params.artifactFormat)}`;

const handleReserve = ({ payload }: { readonly payload: typeof CreateBuildBody.Type }) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      yield* assertPermission("build", "create");
      yield* assertProjectOwnership(payload.projectId);

      const runtime = yield* BuildRuntime;
      const ctx = yield* CurrentActor;
      const buildId = crypto.randomUUID();
      const r2Key = buildArtifactKey({
        organizationId: ctx.organizationId,
        projectId: payload.projectId,
        buildId,
        artifactFormat: payload.artifactFormat,
      });
      const contentType = formatForContentType(payload.artifactFormat);
      const checksumSha256Base64 = yield* sha256HexToBase64(payload.sha256);
      const uploadUrl = yield* runtime.createUploadUrl({
        key: r2Key,
        expiresIn: UPLOAD_EXPIRY_SECONDS,
        contentType,
        checksumSha256Base64,
      });

      const uploadExpiresAt = new Date(Date.now() + UPLOAD_EXPIRY_SECONDS * 1000).toISOString();
      const uploadHeaders = createDirectUploadHeaders({
        checksumSha256Base64,
        contentType,
      });

      const reservation = {
        buildId,
        projectId: payload.projectId,
        platform: payload.platform,
        profile: payload.profile ?? "production",
        distribution: payload.distribution,
        artifactFormat: payload.artifactFormat,
        runtimeVersion: toDbNull(payload.runtimeVersion),
        appVersion: toDbNull(payload.appVersion),
        buildNumber: toDbNull(payload.buildNumber),
        bundleId: toDbNull(payload.bundleId),
        gitRef: toDbNull(payload.gitRef),
        gitCommit: toDbNull(payload.gitCommit),
        gitDirty: payload.gitDirty ?? false,
        message: toDbNull(payload.message),
        metadata: payload.metadata ?? {},
        fingerprintHash: toDbNull(payload.fingerprintHash),
        sha256: payload.sha256.toLowerCase(),
        byteSize: payload.byteSize,
        checksumSha256Base64,
        r2Key,
        organizationId: ctx.organizationId,
      };

      yield* runtime.putReservation({
        id: buildId,
        value: JSON.stringify(reservation),
        ttlSeconds: KV_RESERVATION_TTL,
      });

      yield* logAudit({
        action: "build.reserve",
        resourceType: "build",
        resourceId: buildId,
        projectId: payload.projectId,
        metadata: { platform: payload.platform, projectId: payload.projectId },
      });

      return {
        id: buildId,
        uploadMode: "single" as const,
        uploadUrl,
        uploadExpiresAt,
        uploadHeaders,
      };
    }),
  );

const handleComplete = ({
  path,
  payload,
}: {
  readonly path: { readonly id: string };
  readonly payload: typeof CompleteBuildBody.Type;
}) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      yield* assertPermission("build", "create");

      const runtime = yield* BuildRuntime;

      const reservationJson = yield* runtime.getReservation({ id: path.id });
      if (!reservationJson) {
        return yield* new NotFound({ message: "Build reservation not found or expired" });
      }

      const reservation = yield* parseReservation(reservationJson);

      yield* assertProjectOwnership(reservation.projectId);

      if (
        payload.sha256.toLowerCase() !== reservation.sha256 ||
        payload.byteSize !== reservation.byteSize
      ) {
        return yield* new BadRequest({
          message: "Build completion payload does not match the reserved artifact metadata",
        });
      }

      // Skip server-side R2 head/sha verification: R2 enforces the
      // x-amz-checksum-sha256 header bound into the presigned PUT URL at
      // upload time, so a successful upload already proves the bytes match
      // the reservation's claimed sha. CLI uploads directly to the final
      // key — no staging copy needed.
      const [repo, projectRepo] = yield* Effect.all([BuildRepo, ProjectRepo]);
      const build = yield* repo
        .insert({
          id: path.id,
          projectId: reservation.projectId,
          platform: reservation.platform,
          profile: reservation.profile,
          distribution: reservation.distribution,
          runtimeVersion: reservation.runtimeVersion,
          appVersion: reservation.appVersion,
          buildNumber: reservation.buildNumber,
          bundleId: reservation.bundleId,
          gitRef: reservation.gitRef,
          gitCommit: reservation.gitCommit,
          gitDirty: reservation.gitDirty,
          message: reservation.message,
          metadataJson: JSON.stringify(reservation.metadata),
          fingerprintHash: reservation.fingerprintHash,
          artifact: {
            r2Key: reservation.r2Key,
            format: reservation.artifactFormat,
            contentType: formatForContentType(reservation.artifactFormat),
            byteSize: reservation.byteSize,
            sha256: reservation.sha256,
          },
        })
        .pipe(
          Effect.tapError(() => cleanupBuildObject(reservation.r2Key)),
          Effect.tap((inserted) =>
            projectRepo.bumpLastActivity({
              projectId: reservation.projectId,
              at: inserted.createdAt,
            }),
          ),
        );

      yield* runtime.deleteReservation({ id: path.id });

      yield* logAudit({
        action: "build.complete",
        resourceType: "build",
        resourceId: path.id,
        projectId: reservation.projectId,
      });

      return toApiBuild(build);
    }),
  );

const handleGet = ({ path }: { readonly path: { readonly id: string } }) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      yield* assertPermission("build", "read");

      const repo = yield* BuildRepo;
      const build = yield* repo.findById({ id: path.id });
      yield* assertProjectOwnership(build.projectId);

      return toApiBuild(build);
    }),
  );

const handleCompatibilityMatrix = ({
  urlParams,
}: {
  readonly urlParams: { readonly projectId: string };
}) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      yield* assertPermission("build", "read");
      yield* assertProjectOwnership(urlParams.projectId);

      const repo = yield* CompatibilityRepo;
      return toApiBuildCompatibilityMatrix(
        yield* repo.getBuildMatrix({ projectId: urlParams.projectId }),
      );
    }),
  );

const handleDelete = ({ path }: { readonly path: { readonly id: string } }) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      yield* assertPermission("build", "delete");

      const repo = yield* BuildRepo;
      const build = yield* repo.findById({ id: path.id });
      yield* assertProjectOwnership(build.projectId);

      const { r2Key } = yield* repo.deleteById({ id: path.id });

      if (r2Key) {
        const runtime = yield* BuildRuntime;
        yield* runtime.deleteObjects({ keys: [r2Key] });
      }

      yield* logAudit({
        action: "build.delete",
        resourceType: "build",
        resourceId: path.id,
        projectId: build.projectId,
      });

      return { deleted: 1 };
    }),
  );

const handleGetInstallLink = ({ path }: { readonly path: { readonly id: string } }) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      yield* assertPermission("build", "read");

      const repo = yield* BuildRepo;
      const build = yield* repo.findById({ id: path.id });
      yield* assertProjectOwnership(build.projectId);

      const runtime = yield* BuildRuntime;
      const installTokenSecret = yield* runtime.getInstallTokenSecret;
      if (!installTokenSecret) {
        return yield* new BadRequest({ message: "Install token secret not configured" });
      }

      const { token, expires } = yield* generateInstallToken(path.id, installTokenSecret).pipe(
        Effect.mapError(() => new BadRequest({ message: "Failed to generate install token" })),
      );

      const env = yield* cloudflareEnv;
      const origin = env.PUBLIC_API_URL;

      const artifactUrl = `${origin}/api/builds/${path.id}/artifact?token=${token}&expires=${expires}`;

      const installUrl =
        build.platform === "ios" &&
        (build.distribution === "ad-hoc" || build.distribution === "enterprise") &&
        build.artifact?.format === "ipa" &&
        build.bundleId !== null &&
        build.appVersion !== null
          ? `itms-services://?action=download-manifest&url=${encodeURIComponent(`${origin}/api/builds/${path.id}/install?token=${token}&expires=${expires}`)}`
          : null;

      return { token, expires, artifactUrl, installUrl };
    }),
  );

export const BuildsGroupLive = HttpApiBuilder.group(ManagementApi, "builds", (handlers) =>
  handlers
    .handle("reserve", handleReserve)
    .handle("complete", handleComplete)
    .handle("list", ({ urlParams }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("build", "read");
          yield* assertProjectOwnership(urlParams.projectId);

          const repo = yield* BuildRepo;
          const { page, limit, offset } = parsePagination(urlParams);
          const { sort, order } = parseBuildSort(urlParams.sort);

          const audienceDistributions = resolveAudience(urlParams.audience);

          const { items, total } = yield* repo.list({
            projectId: urlParams.projectId,
            ...(urlParams.platform ? { platform: urlParams.platform } : {}),
            ...(urlParams.profile ? { profile: urlParams.profile } : {}),
            ...(urlParams.runtimeVersion ? { runtimeVersion: urlParams.runtimeVersion } : {}),
            ...(urlParams.distribution ? { distribution: urlParams.distribution } : {}),
            ...(audienceDistributions ? { distributions: audienceDistributions } : {}),
            sort,
            order,
            limit,
            offset,
          });

          return { items: items.map(toApiBuild), total, page, limit };
        }),
      ),
    )
    .handle("get", handleGet)
    .handle("compatibilityMatrix", handleCompatibilityMatrix)
    .handle("delete", handleDelete)
    .handle("getInstallLink", handleGetInstallLink),
);
