import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";

import type { ArtifactFormat, BuildWithArtifactModel, Distribution, Platform } from "../models";

// -- Port ------------------------------------------------------------------

export interface BuildRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly projectId: string;
    readonly platform: Platform;
    readonly profile: string;
    readonly distribution: Distribution;
    readonly runtimeVersion: string | null;
    readonly appVersion: string | null;
    readonly buildNumber: string | null;
    readonly bundleId: string | null;
    readonly gitRef: string | null;
    readonly gitCommit: string | null;
    readonly message: string | null;
    readonly metadataJson: string;
    readonly artifact: {
      readonly r2Key: string;
      readonly format: ArtifactFormat;
      readonly contentType: string;
      readonly byteSize: number;
      readonly sha256: string;
    };
  }) => Effect.Effect<BuildWithArtifactModel>;

  readonly findById: (params: {
    readonly id: string;
  }) => Effect.Effect<BuildWithArtifactModel, NotFound>;

  readonly findArtifactR2KeyById: (params: { readonly id: string }) => Effect.Effect<string | null>;

  readonly findArtifactR2KeyByIdAndOrg: (params: {
    readonly id: string;
    readonly organizationId: string;
  }) => Effect.Effect<string | null>;

  readonly findInstallInfoById: (params: { readonly id: string }) => Effect.Effect<{
    readonly distribution: Distribution;
    readonly bundleId: string | null;
    readonly appVersion: string | null;
    readonly message: string | null;
    readonly r2Key: string;
  } | null>;

  readonly findExpiredArtifactBatch: (params: {
    readonly profile: string;
    readonly cutoff: string;
    readonly limit: number;
  }) => Effect.Effect<readonly { readonly id: string; readonly r2Key: string }[]>;

  readonly deleteArtifactMetadataBatch: (params: {
    readonly buildIds: readonly string[];
  }) => Effect.Effect<void>;

  readonly list: (params: {
    readonly projectId: string;
    readonly platform?: Platform;
    readonly profile?: string;
    readonly runtimeVersion?: string;
    readonly limit: number;
    readonly offset: number;
  }) => Effect.Effect<{
    readonly items: readonly BuildWithArtifactModel[];
    readonly total: number;
  }>;

  readonly deleteById: (params: {
    readonly id: string;
  }) => Effect.Effect<{ readonly r2Key: string | null }, NotFound>;
}

export class BuildRepo extends Context.Tag("api/BuildRepo")<BuildRepo, BuildRepository>() {}

// -- D1 Adapter ------------------------------------------------------------

interface BuildRow {
  id: string;
  project_id: string;
  platform: Platform;
  profile: string;
  distribution: Distribution;
  runtime_version: string | null;
  app_version: string | null;
  build_number: string | null;
  bundle_id: string | null;
  git_ref: string | null;
  git_commit: string | null;
  message: string | null;
  metadata_json: string;
  created_at: string;
  a_r2_key: string | null;
  a_format: ArtifactFormat | null;
  a_content_type: string | null;
  a_byte_size: number | null;
  a_sha256: string | null;
}

interface BuildInstallRow {
  distribution: Distribution;
  bundle_id: string | null;
  app_version: string | null;
  message: string | null;
  r2_key: string;
}

const toBuildWithArtifact = (row: BuildRow) =>
  ({
    id: row.id,
    projectId: row.project_id,
    platform: row.platform,
    profile: row.profile,
    distribution: row.distribution,
    runtimeVersion: row.runtime_version,
    appVersion: row.app_version,
    buildNumber: row.build_number,
    bundleId: row.bundle_id,
    gitRef: row.git_ref,
    gitCommit: row.git_commit,
    message: row.message,
    metadataJson: row.metadata_json,
    createdAt: row.created_at,
    artifact:
      row.a_r2_key && row.a_format
        ? {
            r2Key: row.a_r2_key,
            format: row.a_format,
            contentType: row.a_content_type ?? "application/octet-stream",
            byteSize: row.a_byte_size ?? 0,
            sha256: row.a_sha256 ?? "",
          }
        : null,
  }) satisfies BuildWithArtifactModel;

const SELECT_WITH_ARTIFACT = `SELECT b."id", b."project_id", b."platform", b."profile", b."distribution", b."runtime_version", b."app_version", b."build_number", b."bundle_id", b."git_ref", b."git_commit", b."message", b."metadata_json", b."created_at", a."r2_key" AS "a_r2_key", a."format" AS "a_format", a."content_type" AS "a_content_type", a."byte_size" AS "a_byte_size", a."sha256" AS "a_sha256" FROM "builds" b LEFT JOIN "build_artifacts" a ON a."build_id" = b."id"`;

export const BuildRepoLive = Layer.succeed(BuildRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const now = new Date().toISOString();

      yield* Effect.promise(async () =>
        env.DB.batch([
          env.DB.prepare(
            `INSERT INTO "builds" ("id", "project_id", "platform", "profile", "distribution", "runtime_version", "app_version", "build_number", "bundle_id", "git_ref", "git_commit", "message", "metadata_json", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            params.id,
            params.projectId,
            params.platform,
            params.profile,
            params.distribution,
            params.runtimeVersion,
            params.appVersion,
            params.buildNumber,
            params.bundleId,
            params.gitRef,
            params.gitCommit,
            params.message,
            params.metadataJson,
            now,
          ),
          env.DB.prepare(
            `INSERT INTO "build_artifacts" ("build_id", "r2_key", "format", "content_type", "byte_size", "sha256", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            params.id,
            params.artifact.r2Key,
            params.artifact.format,
            params.artifact.contentType,
            params.artifact.byteSize,
            params.artifact.sha256,
            now,
          ),
        ]),
      );

      return {
        id: params.id,
        projectId: params.projectId,
        platform: params.platform,
        profile: params.profile,
        distribution: params.distribution,
        runtimeVersion: params.runtimeVersion,
        appVersion: params.appVersion,
        buildNumber: params.buildNumber,
        bundleId: params.bundleId,
        gitRef: params.gitRef,
        gitCommit: params.gitCommit,
        message: params.message,
        metadataJson: params.metadataJson,
        createdAt: now,
        artifact: {
          r2Key: params.artifact.r2Key,
          format: params.artifact.format,
          contentType: params.artifact.contentType,
          byteSize: params.artifact.byteSize,
          sha256: params.artifact.sha256,
        },
      } satisfies BuildWithArtifactModel;
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`${SELECT_WITH_ARTIFACT} WHERE b."id" = ?`)
          .bind(params.id)
          .first<BuildRow>(),
      );

      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Build not found" }));
      }

      return toBuildWithArtifact(row);
    }),

  findArtifactR2KeyById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT "r2_key" FROM "build_artifacts" WHERE "build_id" = ?`)
          .bind(params.id)
          .first<{ r2_key: string }>(),
      );
      return row?.r2_key ?? null;
    }),

  findArtifactR2KeyByIdAndOrg: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT a."r2_key" FROM "build_artifacts" a JOIN "builds" b ON b."id" = a."build_id" JOIN "projects" p ON p."id" = b."project_id" WHERE a."build_id" = ? AND p."organization_id" = ?`,
        )
          .bind(params.id, params.organizationId)
          .first<{ r2_key: string }>(),
      );
      return row?.r2_key ?? null;
    }),

  findInstallInfoById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT b."distribution", b."bundle_id", b."app_version", b."message", a."r2_key" FROM "builds" b JOIN "build_artifacts" a ON a."build_id" = b."id" WHERE b."id" = ?`,
        )
          .bind(params.id)
          .first<BuildInstallRow>(),
      );

      return row
        ? {
            distribution: row.distribution,
            bundleId: row.bundle_id,
            appVersion: row.app_version,
            message: row.message,
            r2Key: row.r2_key,
          }
        : null;
    }),

  findExpiredArtifactBatch: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT b."id", a."r2_key" AS "r2_key" FROM "builds" b JOIN "build_artifacts" a ON a."build_id" = b."id" WHERE b."profile" = ? AND b."created_at" < ? LIMIT ?`,
        )
          .bind(params.profile, params.cutoff, params.limit)
          .all<{ id: string; r2_key: string }>(),
      );

      return rows.results.map((row) => ({ id: row.id, r2Key: row.r2_key }));
    }),

  deleteArtifactMetadataBatch: (params) =>
    Effect.gen(function* () {
      if (params.buildIds.length === 0) {
        return;
      }

      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.batch(
          params.buildIds.map((id) =>
            env.DB.prepare(`DELETE FROM "build_artifacts" WHERE "build_id" = ?`).bind(id),
          ),
        ),
      );
    }),

  list: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const conditions: string[] = ['b."project_id" = ?'];
      const bindValues: (string | number)[] = [params.projectId];

      if (params.platform) {
        conditions.push('b."platform" = ?');
        bindValues.push(params.platform);
      }
      if (params.profile) {
        conditions.push('b."profile" = ?');
        bindValues.push(params.profile);
      }
      if (params.runtimeVersion) {
        conditions.push('b."runtime_version" = ?');
        bindValues.push(params.runtimeVersion);
      }

      const whereClause = conditions.join(" AND ");

      const [countResult, rows] = yield* Effect.all(
        [
          Effect.promise(async () =>
            env.DB.prepare(`SELECT COUNT(*) as count FROM "builds" b WHERE ${whereClause}`)
              .bind(...bindValues)
              .first<{ count: number }>(),
          ),
          Effect.promise(async () =>
            env.DB.prepare(
              `${SELECT_WITH_ARTIFACT} WHERE ${whereClause} ORDER BY b."created_at" DESC LIMIT ? OFFSET ?`,
            )
              .bind(...bindValues, params.limit, params.offset)
              .all<BuildRow>(),
          ),
        ],
        { concurrency: "unbounded" },
      );

      return { items: rows.results.map(toBuildWithArtifact), total: countResult?.count ?? 0 };
    }),

  deleteById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const artifact = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT "r2_key" FROM "build_artifacts" WHERE "build_id" = ?`)
          .bind(params.id)
          .first<{ r2_key: string }>(),
      );

      const result = yield* Effect.promise(async () =>
        env.DB.prepare(`DELETE FROM "builds" WHERE "id" = ?`).bind(params.id).run(),
      );

      if (result.meta.changes === 0) {
        return yield* Effect.fail(new NotFound({ message: "Build not found" }));
      }

      return { r2Key: artifact?.r2_key ?? null };
    }),
});
