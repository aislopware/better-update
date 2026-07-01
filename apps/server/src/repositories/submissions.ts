import { Context, Effect, Layer } from "effect";

import type { Expression, SqlBool, Selectable } from "kysely";

import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";

import type { Submissions } from "../db/schema";
import type { Platform } from "../models";
import type { SubmissionArchiveSource, SubmissionModel } from "../submission-models";

// -- Port -------------------------------------------------------------------

export interface SubmissionInsert {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly platform: Platform;
  readonly profileName: string;
  readonly archiveSource: SubmissionArchiveSource;
  readonly buildId: string | null;
  readonly archiveUrl: string | null;
  readonly submissionConfigJson: string;
  readonly metadataComplete: boolean;
  readonly buildVersion: string | null;
  readonly initiatingUserId: string | null;
  readonly createdAt: string;
}

export interface SubmissionsRepository {
  readonly insert: (params: SubmissionInsert) => Effect.Effect<void>;

  /**
   * Latest submission recorded for a CFBundleVersion, so a re-run of the same
   * build updates its row (idempotent per build) instead of appending a duplicate.
   */
  readonly findLatestByBuildVersion: (params: {
    readonly projectId: string;
    readonly platform: Platform;
    readonly buildVersion: string;
  }) => Effect.Effect<SubmissionModel | null>;

  /** Refresh a submission's mutable fields on a re-run of the same build. */
  readonly update: (params: {
    readonly id: string;
    readonly profileName: string;
    readonly archiveSource: SubmissionArchiveSource;
    readonly buildId: string | null;
    readonly archiveUrl: string | null;
    readonly submissionConfigJson: string;
    readonly metadataComplete: boolean;
    readonly initiatingUserId: string | null;
    readonly createdAt: string;
  }) => Effect.Effect<void>;

  readonly listByProject: (params: {
    readonly projectId: string;
    readonly platform?: Platform | undefined;
    readonly profile?: string | undefined;
    readonly buildId?: string | undefined;
    readonly limit: number;
    readonly offset: number;
  }) => Effect.Effect<{ readonly items: readonly SubmissionModel[]; readonly total: number }>;

  readonly findById: (params: { readonly id: string }) => Effect.Effect<SubmissionModel, NotFound>;

  readonly delete: (params: { readonly id: string }) => Effect.Effect<void>;
}

export class SubmissionsRepo extends Context.Tag("api/SubmissionsRepo")<
  SubmissionsRepo,
  SubmissionsRepository
>() {}

// -- D1 Adapter -------------------------------------------------------------

const toModel = (row: Selectable<Submissions>): SubmissionModel => ({
  id: row.id,
  organizationId: row.organization_id,
  projectId: row.project_id,
  platform: row.platform,
  profileName: row.profile_name,
  archiveSource: row.archive_source,
  buildId: row.build_id,
  archiveUrl: row.archive_url,
  submissionConfigJson: row.submission_config,
  metadataComplete: row.metadata_complete !== 0,
  buildVersion: row.build_version,
  initiatingUserId: row.initiating_user_id,
  createdAt: row.created_at,
});

export const SubmissionsRepoLive = Layer.succeed(SubmissionsRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .insertInto("submissions")
          .values({
            id: params.id,
            organization_id: params.organizationId,
            project_id: params.projectId,
            platform: params.platform,
            profile_name: params.profileName,
            archive_source: params.archiveSource,
            build_id: params.buildId,
            archive_url: params.archiveUrl,
            submission_config: params.submissionConfigJson,
            metadata_complete: params.metadataComplete ? 1 : 0,
            build_version: params.buildVersion,
            initiating_user_id: params.initiatingUserId,
            created_at: params.createdAt,
          })
          .execute(),
      );
    }),

  findLatestByBuildVersion: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("submissions")
          .selectAll()
          .where("project_id", "=", params.projectId)
          .where("platform", "=", params.platform)
          .where("build_version", "=", params.buildVersion)
          .orderBy("created_at", "desc")
          .limit(1)
          .executeTakeFirst(),
      );
      return row === undefined ? null : toModel(row);
    }),

  update: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .updateTable("submissions")
          .set({
            profile_name: params.profileName,
            archive_source: params.archiveSource,
            build_id: params.buildId,
            archive_url: params.archiveUrl,
            submission_config: params.submissionConfigJson,
            metadata_complete: params.metadataComplete ? 1 : 0,
            initiating_user_id: params.initiatingUserId,
            created_at: params.createdAt,
          })
          .where("id", "=", params.id)
          .execute(),
      );
    }),

  listByProject: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const { platform, profile, buildId } = params;
      // Shared by the count and page queries so `total` respects the filters.
      const filtered = db
        .selectFrom("submissions")
        .where("project_id", "=", params.projectId)
        .where((eb) => {
          const conditions: (Expression<SqlBool> | null)[] = [
            platform === undefined ? null : eb("platform", "=", platform),
            profile === undefined ? null : eb("profile_name", "=", profile),
            buildId === undefined ? null : eb("build_id", "=", buildId),
          ];
          return eb.and(conditions.filter((cond): cond is Expression<SqlBool> => cond !== null));
        });
      const countRow = yield* Effect.promise(async () =>
        filtered.select((eb) => eb.fn.countAll<number>().as("count")).executeTakeFirstOrThrow(),
      );
      const rows = yield* Effect.promise(async () =>
        filtered
          .selectAll()
          .orderBy("created_at", "desc")
          .limit(params.limit)
          .offset(params.offset)
          .execute(),
      );
      return { items: rows.map(toModel), total: countRow.count };
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db.selectFrom("submissions").selectAll().where("id", "=", params.id).executeTakeFirst(),
      );
      if (row === undefined) {
        return yield* new NotFound({ message: "Submission not found" });
      }
      return toModel(row);
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db.deleteFrom("submissions").where("id", "=", params.id).execute(),
      );
    }),
});
