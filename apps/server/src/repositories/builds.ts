import { toDbNull } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import type { Kysely } from "kysely";

import { d1Batch, kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";
import { toBuildWithArtifact } from "./build-row";

import type { DB } from "../db/schema";
import type { ArtifactFormat, BuildWithArtifactModel, Distribution, Platform } from "../models";

export type BuildSortKey =
  | "createdAt"
  | "platform"
  | "distribution"
  | "runtimeVersion"
  | "appVersion";

export type BuildSortOrder = "asc" | "desc";

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
    readonly gitDirty: boolean;
    readonly message: string | null;
    readonly metadataJson: string;
    readonly fingerprintHash: string | null;
    readonly artifact: {
      readonly r2Key: string;
      readonly format: ArtifactFormat;
      readonly contentType: string;
      readonly byteSize: number;
      readonly sha256: string;
    };
  }) => Effect.Effect<BuildWithArtifactModel>;

  readonly listByProjectAndFingerprint: (params: {
    readonly projectId: string;
    readonly fingerprintHash: string;
  }) => Effect.Effect<readonly BuildWithArtifactModel[]>;

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
    readonly distribution?: Distribution;
    readonly distributions?: readonly Distribution[];
    readonly query?: string;
    readonly sort: BuildSortKey;
    readonly order: BuildSortOrder;
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

/**
 * Base build projection: every stored column plus the LEFT-joined artifact
 * columns aliased `a_*`. Shared by every read so the `toBuildWithArtifact`
 * mapper always sees an identical row shape. The domain-narrowed columns
 * (`platform`, `distribution`, `a_format`) and the non-null `id` are `$castTo`'d
 * from their wider schema types so the inferred row matches the mapper input.
 */
const selectBuildsWithArtifact = (db: Kysely<DB>) =>
  db
    .selectFrom("builds as b")
    .leftJoin("build_artifacts as a", "a.build_id", "b.id")
    .select((eb) => [
      eb.ref("b.id").$castTo<string>().as("id"),
      "b.project_id",
      eb.ref("b.platform").$castTo<Platform>().as("platform"),
      "b.profile",
      eb.ref("b.distribution").$castTo<Distribution>().as("distribution"),
      "b.runtime_version",
      "b.app_version",
      "b.build_number",
      "b.bundle_id",
      "b.git_ref",
      "b.git_commit",
      "b.git_dirty",
      "b.message",
      "b.metadata_json",
      "b.fingerprint_hash",
      "b.created_at",
      eb.ref("a.r2_key").as("a_r2_key"),
      eb.ref("a.format").$castTo<ArtifactFormat | null>().as("a_format"),
      eb.ref("a.content_type").as("a_content_type"),
      eb.ref("a.byte_size").as("a_byte_size"),
      eb.ref("a.sha256").as("a_sha256"),
    ]);

// Sort whitelist → `builds` column reference. The trailing `b.id` tie-break that
// keeps pagination stable is applied at the call site.
const buildSortColumn = {
  createdAt: "b.created_at",
  platform: "b.platform",
  distribution: "b.distribution",
  runtimeVersion: "b.runtime_version",
  appVersion: "b.app_version",
} as const satisfies Record<BuildSortKey, string>;

export const BuildRepoLive = Layer.succeed(BuildRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const now = new Date().toISOString();

      yield* d1Batch([
        db.insertInto("builds").values({
          id: params.id,
          project_id: params.projectId,
          platform: params.platform,
          profile: params.profile,
          distribution: params.distribution,
          runtime_version: params.runtimeVersion,
          app_version: params.appVersion,
          build_number: params.buildNumber,
          bundle_id: params.bundleId,
          git_ref: params.gitRef,
          git_commit: params.gitCommit,
          git_dirty: params.gitDirty ? 1 : 0,
          message: params.message,
          metadata_json: params.metadataJson,
          fingerprint_hash: params.fingerprintHash,
          created_at: now,
        }),
        db.insertInto("build_artifacts").values({
          build_id: params.id,
          r2_key: params.artifact.r2Key,
          format: params.artifact.format,
          content_type: params.artifact.contentType,
          byte_size: params.artifact.byteSize,
          sha256: params.artifact.sha256,
          created_at: now,
        }),
      ]);

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
        gitDirty: params.gitDirty,
        message: params.message,
        metadataJson: params.metadataJson,
        fingerprintHash: params.fingerprintHash,
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
      const db = yield* kyselyDb;

      const row = yield* Effect.promise(async () =>
        selectBuildsWithArtifact(db).where("b.id", "=", params.id).executeTakeFirst(),
      );

      if (!row) {
        return yield* new NotFound({ message: "Build not found" });
      }

      return toBuildWithArtifact(row);
    }),

  findArtifactR2KeyById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("build_artifacts")
          .select("r2_key")
          .where("build_id", "=", params.id)
          .executeTakeFirst(),
      );
      return toDbNull(row?.r2_key);
    }),

  findArtifactR2KeyByIdAndOrg: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("build_artifacts as a")
          .innerJoin("builds as b", "b.id", "a.build_id")
          .innerJoin("projects as p", "p.id", "b.project_id")
          .select("a.r2_key")
          .where("a.build_id", "=", params.id)
          .where("p.organization_id", "=", params.organizationId)
          .executeTakeFirst(),
      );
      return toDbNull(row?.r2_key);
    }),

  findInstallInfoById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("builds as b")
          .innerJoin("build_artifacts as a", "a.build_id", "b.id")
          .select((eb) => [
            eb.ref("b.distribution").$castTo<Distribution>().as("distribution"),
            "b.bundle_id",
            "b.app_version",
            "b.message",
            "a.r2_key",
          ])
          .where("b.id", "=", params.id)
          .executeTakeFirst(),
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
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("builds as b")
          .innerJoin("build_artifacts as a", "a.build_id", "b.id")
          .select((eb) => [eb.ref("b.id").$castTo<string>().as("id"), "a.r2_key"])
          .where("b.profile", "=", params.profile)
          .where("b.created_at", "<", params.cutoff)
          .limit(params.limit)
          .execute(),
      );

      return rows.map((row) => ({ id: row.id, r2Key: row.r2_key }));
    }),

  deleteArtifactMetadataBatch: (params) =>
    Effect.gen(function* () {
      if (params.buildIds.length === 0) {
        return;
      }

      const db = yield* kyselyDb;
      yield* d1Batch(
        params.buildIds.map((id) => db.deleteFrom("build_artifacts").where("build_id", "=", id)),
      );
    }),

  list: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      // Case-insensitive LIKE substring match on message, git commit or git ref
      // (builds have no FTS table — LIKE is the only search path). Applied to
      // BOTH the count and page queries so `total` respects the search.
      const pattern = params.query ? `%${params.query.toLowerCase()}%` : undefined;

      const countRow = yield* Effect.promise(async () =>
        db
          .selectFrom("builds")
          .where((eb) =>
            eb.and([
              eb("project_id", "=", params.projectId),
              ...(params.platform ? [eb("platform", "=", params.platform)] : []),
              ...(params.profile ? [eb("profile", "=", params.profile)] : []),
              ...(params.runtimeVersion ? [eb("runtime_version", "=", params.runtimeVersion)] : []),
              ...(params.distribution ? [eb("distribution", "=", params.distribution)] : []),
              ...(params.distributions && params.distributions.length > 0
                ? [eb("distribution", "in", [...params.distributions])]
                : []),
              ...(pattern
                ? [
                    eb.or([
                      eb(eb.fn<string>("lower", ["message"]), "like", pattern),
                      eb(eb.fn<string>("lower", ["git_commit"]), "like", pattern),
                      eb(eb.fn<string>("lower", ["git_ref"]), "like", pattern),
                    ]),
                  ]
                : []),
            ]),
          )
          .select((eb) => eb.fn.countAll<number>().as("count"))
          .executeTakeFirstOrThrow(),
      );
      const total = countRow.count;

      const rows = yield* Effect.promise(async () =>
        selectBuildsWithArtifact(db)
          .where((eb) =>
            eb.and([
              eb("b.project_id", "=", params.projectId),
              ...(params.platform ? [eb("b.platform", "=", params.platform)] : []),
              ...(params.profile ? [eb("b.profile", "=", params.profile)] : []),
              ...(params.runtimeVersion
                ? [eb("b.runtime_version", "=", params.runtimeVersion)]
                : []),
              ...(params.distribution ? [eb("b.distribution", "=", params.distribution)] : []),
              ...(params.distributions && params.distributions.length > 0
                ? [eb("b.distribution", "in", [...params.distributions])]
                : []),
              ...(pattern
                ? [
                    eb.or([
                      eb(eb.fn<string>("lower", ["b.message"]), "like", pattern),
                      eb(eb.fn<string>("lower", ["b.git_commit"]), "like", pattern),
                      eb(eb.fn<string>("lower", ["b.git_ref"]), "like", pattern),
                    ]),
                  ]
                : []),
            ]),
          )
          .orderBy(buildSortColumn[params.sort], params.order)
          .orderBy("b.id", params.order)
          .limit(params.limit)
          .offset(params.offset)
          .execute(),
      );

      return { items: rows.map(toBuildWithArtifact), total };
    }),

  listByProjectAndFingerprint: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        selectBuildsWithArtifact(db)
          .where("b.project_id", "=", params.projectId)
          .where("b.fingerprint_hash", "=", params.fingerprintHash)
          .orderBy("b.created_at", "desc")
          .orderBy("b.id", "desc")
          .execute(),
      );
      return rows.map(toBuildWithArtifact);
    }),

  deleteById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const artifact = yield* Effect.promise(async () =>
        db
          .selectFrom("build_artifacts")
          .select("r2_key")
          .where("build_id", "=", params.id)
          .executeTakeFirst(),
      );

      const deleted = yield* Effect.promise(async () =>
        db.deleteFrom("builds").where("id", "=", params.id).returning("id").executeTakeFirst(),
      );

      if (deleted === undefined) {
        return yield* new NotFound({ message: "Build not found" });
      }

      return { r2Key: toDbNull(artifact?.r2_key) };
    }),
});
