import { compact } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import type { Expression, SqlBool, Selectable } from "kysely";

import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";

import type { Submissions } from "../db/schema";
import type { Platform } from "../models";
import type {
  SubmissionArchiveSource,
  SubmissionModel,
  SubmissionStatus,
} from "../submission-models";

// -- Port -------------------------------------------------------------------

export interface SubmissionsRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly platform: Platform;
    readonly profileName: string;
    readonly status: SubmissionStatus;
    readonly archiveSource: SubmissionArchiveSource;
    readonly buildId: string | null;
    readonly archiveUrl: string | null;
    readonly submissionConfigJson: string;
    readonly initiatingUserId: string | null;
    readonly queuedAt: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  }) => Effect.Effect<void>;

  readonly listByProject: (params: {
    readonly projectId: string;
    readonly status?: SubmissionStatus | undefined;
    readonly platform?: Platform | undefined;
    readonly profile?: string | undefined;
    readonly buildId?: string | undefined;
  }) => Effect.Effect<readonly SubmissionModel[]>;

  readonly findById: (params: { readonly id: string }) => Effect.Effect<SubmissionModel, NotFound>;

  readonly updateStatus: (params: {
    readonly id: string;
    readonly status: SubmissionStatus;
    readonly errorCode?: string | null | undefined;
    readonly errorMessage?: string | null | undefined;
    readonly logFilesJson?: string | undefined;
    readonly startedAt?: string | null | undefined;
    readonly completedAt?: string | null | undefined;
    readonly updatedAt: string;
  }) => Effect.Effect<void>;

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
  status: row.status,
  archiveSource: row.archive_source,
  buildId: row.build_id,
  archiveUrl: row.archive_url,
  submissionConfigJson: row.submission_config,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  logFilesJson: row.log_files,
  initiatingUserId: row.initiating_user_id,
  queuedAt: row.queued_at,
  startedAt: row.started_at,
  completedAt: row.completed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
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
            status: params.status,
            archive_source: params.archiveSource,
            build_id: params.buildId,
            archive_url: params.archiveUrl,
            submission_config: params.submissionConfigJson,
            error_code: null,
            error_message: null,
            log_files: "[]",
            initiating_user_id: params.initiatingUserId,
            queued_at: params.queuedAt,
            started_at: null,
            completed_at: null,
            created_at: params.createdAt,
            updated_at: params.updatedAt,
          })
          .execute(),
      );
    }),

  listByProject: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const { status, platform, profile, buildId } = params;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("submissions")
          .selectAll()
          .where("project_id", "=", params.projectId)
          .where((eb) => {
            const conditions: (Expression<SqlBool> | null)[] = [
              status === undefined ? null : eb("status", "=", status),
              platform === undefined ? null : eb("platform", "=", platform),
              profile === undefined ? null : eb("profile_name", "=", profile),
              buildId === undefined ? null : eb("build_id", "=", buildId),
            ];
            return eb.and(conditions.filter((cond): cond is Expression<SqlBool> => cond !== null));
          })
          .orderBy("created_at", "desc")
          .execute(),
      );
      return rows.map(toModel);
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

  updateStatus: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const patch = compact({
        status: params.status,
        updated_at: params.updatedAt,
        error_code: params.errorCode,
        error_message: params.errorMessage,
        log_files: params.logFilesJson,
        started_at: params.startedAt,
        completed_at: params.completedAt,
      });
      yield* Effect.promise(async () =>
        db.updateTable("submissions").set(patch).where("id", "=", params.id).execute(),
      );
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db.deleteFrom("submissions").where("id", "=", params.id).execute(),
      );
    }),
});
