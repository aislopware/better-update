import { ArtifactFormat, Distribution } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect, Schema } from "effect";

import type { CompleteBuildBody, CreateBuildBody } from "@better-update/api";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { BuildRuntime } from "../cloudflare/build-runtime";
import { cloudflareEnv, cloudflareRequest } from "../cloudflare/context";
import { generateInstallToken } from "../domain/install-token";
import { BadRequest, NotFound } from "../errors";
import { toApiBuild, toApiBuildCompatibilityMatrix } from "../http/to-api";
import { toApiBadRequestReadEffect } from "../http/to-api-effect";
import { BuildRepo, CompatibilityRepo } from "../repositories";

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

const requestOrigin = (request: Request) => new URL(request.url).origin;

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (bytes: Uint8Array) => {
  const digestInput = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput);
  return toHex(new Uint8Array(digest));
};

const testBuildStorageUrl = ({
  origin,
  mode,
  key,
}: {
  readonly origin: string;
  readonly mode: "upload" | "download";
  readonly key: string;
}) => {
  const url = new URL(
    mode === "upload" ? "/__test/build-upload" : "/__test/build-download",
    origin,
  );
  url.searchParams.set("key", key);
  return url.toString();
};

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

const handleReserve = ({ payload }: { readonly payload: typeof CreateBuildBody.Type }) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      yield* assertPermission("build", "create");
      yield* assertProjectOwnership(payload.projectId);

      const runtime = yield* BuildRuntime;
      const env = yield* cloudflareEnv;
      const ctx = yield* CurrentActor;
      const request = yield* cloudflareRequest;

      const buildId = crypto.randomUUID();
      const stagingKey = `staging/${ctx.organizationId}/${buildId}.${artifactExt(payload.artifactFormat)}`;
      const uploadUrl =
        env.TEST_MODE === "true"
          ? testBuildStorageUrl({
              origin: requestOrigin(request),
              mode: "upload",
              key: stagingKey,
            })
          : yield* runtime.createUploadUrl({
              key: stagingKey,
              expiresIn: UPLOAD_EXPIRY_SECONDS,
            });

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

      yield* runtime.putReservation({
        id: buildId,
        value: JSON.stringify(reservation),
        ttlSeconds: KV_RESERVATION_TTL,
      });

      yield* logAudit({
        action: "build.reserve",
        resourceType: "build",
        resourceId: buildId,
        metadata: { platform: payload.platform, projectId: payload.projectId },
      });

      return { id: buildId, uploadUrl, uploadExpiresAt };
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
        return yield* Effect.fail(
          new NotFound({ message: "Build reservation not found or expired" }),
        );
      }

      const reservation = decodeReservation(JSON.parse(reservationJson));

      yield* assertProjectOwnership(reservation.projectId);

      const stagingObject = yield* runtime.getObject({ key: reservation.stagingKey });
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

      const artifactBytes = yield* Effect.tryPromise({
        try: async () =>
          new Uint8Array(await new Response(stagingObject.body ?? new Uint8Array()).arrayBuffer()),
        catch: (cause) =>
          new BadRequest({
            message: `Failed to read staged artifact: ${String(cause)}`,
          }),
      });
      const computedSha256 = yield* Effect.tryPromise({
        try: async () => sha256Hex(artifactBytes),
        catch: (cause) =>
          new BadRequest({
            message: `Failed to hash staged artifact: ${String(cause)}`,
          }),
      });
      if (computedSha256 !== payload.sha256.toLowerCase()) {
        return yield* Effect.fail(
          new BadRequest({
            message: `Artifact SHA-256 mismatch: expected ${payload.sha256}, got ${computedSha256}`,
          }),
        );
      }

      const finalKey = `builds/${reservation.organizationId}/${reservation.projectId}/${path.id}.${artifactExt(reservation.artifactFormat)}`;

      yield* runtime.putObject({
        key: finalKey,
        body: artifactBytes,
        contentType: formatForContentType(reservation.artifactFormat),
      });

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
          byteSize: artifactBytes.byteLength,
          sha256: computedSha256,
        },
      });

      yield* Effect.all(
        [
          runtime.deleteObjects({ keys: [reservation.stagingKey] }),
          runtime.deleteReservation({ id: path.id }),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.catchAll(() => Effect.void));

      yield* logAudit({
        action: "build.complete",
        resourceType: "build",
        resourceId: path.id,
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
        yield* runtime.deleteObjects({ keys: [r2Key] }).pipe(Effect.catchAll(() => Effect.void));
      }

      yield* logAudit({
        action: "build.delete",
        resourceType: "build",
        resourceId: path.id,
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
        return yield* Effect.fail(
          new BadRequest({ message: "Install token secret not configured" }),
        );
      }

      const { token, expires } = yield* Effect.promise(async () =>
        generateInstallToken(path.id, installTokenSecret),
      );

      const request = yield* cloudflareRequest;
      const { origin } = new URL(request.url);

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

          return { items: items.map(toApiBuild), total, page, limit };
        }),
      ),
    )
    .handle("get", handleGet)
    .handle("compatibilityMatrix", handleCompatibilityMatrix)
    .handle("delete", handleDelete)
    .handle("getInstallLink", handleGetInstallLink),
);
