import {
  ArtifactFormat,
  AuthContext,
  BadRequest,
  Distribution,
  NotFound,
} from "@better-update/api";
import { HttpApiBuilder, HttpServerRequest } from "@effect/platform";
import { Effect, Schema } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { cloudflareEnv } from "../cloudflare/context";
import { generateInstallToken } from "../domain/install-token";
import { generateUploadUrl } from "../domain/presigned-url";
import { BuildRepo } from "../repositories/builds";

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
  message: Schema.NullOr(Schema.String),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  stagingKey: Schema.String,
  organizationId: Schema.String,
});

const decodeReservation = Schema.decodeUnknownSync(ReservationSchema);

export const BuildsGroupLive = HttpApiBuilder.group(ManagementApi, "builds", (handlers) =>
  handlers
    .handle("reserve", ({ payload }) =>
      Effect.gen(function* () {
        yield* assertPermission("build", "create");
        yield* assertProjectOwnership(payload.projectId);

        const env = yield* cloudflareEnv;
        const ctx = yield* AuthContext;

        const buildId = crypto.randomUUID();
        const stagingKey = `staging/${ctx.organizationId}/${buildId}.${artifactExt(payload.artifactFormat)}`;

        const uploadUrl = yield* Effect.promise(async () =>
          generateUploadUrl(env, stagingKey, UPLOAD_EXPIRY_SECONDS),
        );

        const uploadExpiresAt = new Date(Date.now() + UPLOAD_EXPIRY_SECONDS * 1000).toISOString();

        const reservation = {
          buildId,
          projectId: payload.projectId,
          platform: payload.platform,
          profile: payload.profile ?? "production",
          distribution: payload.distribution,
          artifactFormat: payload.artifactFormat,
          runtimeVersion: payload.runtimeVersion ?? null,
          appVersion: payload.appVersion ?? null,
          buildNumber: payload.buildNumber ?? null,
          bundleId: payload.bundleId ?? null,
          gitRef: payload.gitRef ?? null,
          gitCommit: payload.gitCommit ?? null,
          message: payload.message ?? null,
          metadata: payload.metadata ?? {},
          stagingKey,
          organizationId: ctx.organizationId,
        };

        yield* Effect.promise(async () =>
          env.BUILD_RESERVATIONS.put(buildId, JSON.stringify(reservation), {
            expirationTtl: KV_RESERVATION_TTL,
          }),
        );

        yield* logAudit({
          action: "build.reserve",
          resourceType: "build",
          resourceId: buildId,
          metadata: { platform: payload.platform, projectId: payload.projectId },
        });

        return { id: buildId, uploadUrl, uploadExpiresAt };
      }),
    )
    .handle("complete", ({ path, payload }) =>
      Effect.gen(function* () {
        yield* assertPermission("build", "create");

        const env = yield* cloudflareEnv;

        const reservationJson = yield* Effect.promise(async () =>
          env.BUILD_RESERVATIONS.get(path.id),
        );
        if (!reservationJson) {
          return yield* Effect.fail(
            new NotFound({ message: "Build reservation not found or expired" }),
          );
        }

        const reservation = decodeReservation(JSON.parse(reservationJson));

        yield* assertProjectOwnership(reservation.projectId);

        const stagingObject = yield* Effect.promise(async () =>
          env.BUILD_BUCKET.get(reservation.stagingKey),
        );
        if (!stagingObject) {
          return yield* Effect.fail(new NotFound({ message: "Artifact not uploaded to staging" }));
        }

        if (stagingObject.size !== payload.byteSize) {
          return yield* Effect.fail(
            new BadRequest({
              message: `Artifact size mismatch: expected ${payload.byteSize}, got ${stagingObject.size}`,
            }),
          );
        }

        const finalKey = `builds/${reservation.organizationId}/${reservation.projectId}/${path.id}.${artifactExt(reservation.artifactFormat)}`;

        yield* Effect.promise(async () =>
          env.BUILD_BUCKET.put(finalKey, stagingObject.body, {
            httpMetadata: {
              contentType: formatForContentType(reservation.artifactFormat),
            },
          }),
        );

        const repo = yield* BuildRepo;
        const build = yield* repo.insert({
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
          message: reservation.message,
          metadataJson: JSON.stringify(reservation.metadata),
          artifact: {
            r2Key: finalKey,
            format: reservation.artifactFormat,
            contentType: formatForContentType(reservation.artifactFormat),
            byteSize: payload.byteSize,
            sha256: payload.sha256,
          },
        });

        yield* Effect.all(
          [
            Effect.promise(async () => env.BUILD_BUCKET.delete(reservation.stagingKey)),
            Effect.promise(async () => env.BUILD_RESERVATIONS.delete(path.id)),
          ],
          { concurrency: "unbounded" },
        ).pipe(Effect.catchAll(() => Effect.void));

        yield* logAudit({
          action: "build.complete",
          resourceType: "build",
          resourceId: path.id,
        });

        return build;
      }),
    )
    .handle("list", ({ urlParams }) =>
      Effect.gen(function* () {
        yield* assertPermission("build", "read");
        yield* assertProjectOwnership(urlParams.projectId);

        const repo = yield* BuildRepo;
        const page = urlParams.page ?? 1;
        const limit = urlParams.limit ?? 20;
        const offset = (page - 1) * limit;

        const { items, total } = yield* repo.list({
          projectId: urlParams.projectId,
          ...(urlParams.platform ? { platform: urlParams.platform } : {}),
          ...(urlParams.profile ? { profile: urlParams.profile } : {}),
          ...(urlParams.runtimeVersion ? { runtimeVersion: urlParams.runtimeVersion } : {}),
          limit,
          offset,
        });

        return { items, total, page, limit };
      }),
    )
    .handle("get", ({ path }) =>
      Effect.gen(function* () {
        yield* assertPermission("build", "read");

        const repo = yield* BuildRepo;
        const build = yield* repo.findById({ id: path.id });
        yield* assertProjectOwnership(build.projectId);

        return build;
      }),
    )
    .handle("delete", ({ path }) =>
      Effect.gen(function* () {
        yield* assertPermission("build", "delete");

        const repo = yield* BuildRepo;
        const build = yield* repo.findById({ id: path.id });
        yield* assertProjectOwnership(build.projectId);

        const { r2Key } = yield* repo.deleteById({ id: path.id });

        if (r2Key) {
          const env = yield* cloudflareEnv;
          yield* Effect.promise(async () => env.BUILD_BUCKET.delete(r2Key)).pipe(
            Effect.catchAll(() => Effect.void),
          );
        }

        yield* logAudit({
          action: "build.delete",
          resourceType: "build",
          resourceId: path.id,
        });

        return { deleted: 1 };
      }),
    )
    .handle("getInstallLink", ({ path }) =>
      Effect.gen(function* () {
        yield* assertPermission("build", "read");

        const repo = yield* BuildRepo;
        const build = yield* repo.findById({ id: path.id });
        yield* assertProjectOwnership(build.projectId);

        const env = yield* cloudflareEnv;
        if (!env.INSTALL_TOKEN_SECRET) {
          return yield* Effect.fail(
            new BadRequest({ message: "Install token secret not configured" }),
          );
        }

        const { token, expires } = yield* Effect.promise(async () =>
          generateInstallToken(path.id, env.INSTALL_TOKEN_SECRET),
        );

        const req = yield* HttpServerRequest.HttpServerRequest;
        const url = new URL(req.url, `https://${req.headers["host"]}`);
        const { origin } = url;

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
    ),
);
