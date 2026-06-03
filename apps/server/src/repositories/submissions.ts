import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";

import type { Platform } from "../models";
import type {
  SubmissionArchiveSource,
  SubmissionModel,
  SubmissionStatus,
} from "../submission-models";

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

interface Row {
  id: string;
  organization_id: string;
  project_id: string;
  platform: Platform;
  profile_name: string;
  status: SubmissionStatus;
  archive_source: SubmissionArchiveSource;
  build_id: string | null;
  archive_url: string | null;
  submission_config: string;
  error_code: string | null;
  error_message: string | null;
  log_files: string;
  initiating_user_id: string | null;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `"id", "organization_id", "project_id", "platform", "profile_name", "status", "archive_source", "build_id", "archive_url", "submission_config", "error_code", "error_message", "log_files", "initiating_user_id", "queued_at", "started_at", "completed_at", "created_at", "updated_at"`;

const toModel = (row: Row): SubmissionModel => ({
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
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(
          `INSERT INTO "submissions" (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '[]', ?, ?, NULL, NULL, ?, ?)`,
        )
          .bind(
            params.id,
            params.organizationId,
            params.projectId,
            params.platform,
            params.profileName,
            params.status,
            params.archiveSource,
            params.buildId,
            params.archiveUrl,
            params.submissionConfigJson,
            params.initiatingUserId,
            params.queuedAt,
            params.createdAt,
            params.updatedAt,
          )
          .run(),
      );
    }),

  listByProject: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const conditions: string[] = [`"project_id" = ?`];
      const bindings: (string | null)[] = [params.projectId];
      if (params.status !== undefined) {
        conditions.push(`"status" = ?`);
        bindings.push(params.status);
      }
      if (params.platform !== undefined) {
        conditions.push(`"platform" = ?`);
        bindings.push(params.platform);
      }
      if (params.profile !== undefined) {
        conditions.push(`"profile_name" = ?`);
        bindings.push(params.profile);
      }
      if (params.buildId !== undefined) {
        conditions.push(`"build_id" = ?`);
        bindings.push(params.buildId);
      }
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "submissions" WHERE ${conditions.join(" AND ")} ORDER BY "created_at" DESC`,
        )
          .bind(...bindings)
          .all<Row>(),
      );
      return rows.results.map(toModel);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${COLUMNS} FROM "submissions" WHERE "id" = ?`)
          .bind(params.id)
          .first<Row>(),
      );
      if (row === null) {
        return yield* new NotFound({ message: "Submission not found" });
      }
      return toModel(row);
    }),

  updateStatus: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const sets: string[] = [`"status" = ?`, `"updated_at" = ?`];
      const bindings: (string | null)[] = [params.status, params.updatedAt];
      if (params.errorCode !== undefined) {
        sets.push(`"error_code" = ?`);
        bindings.push(params.errorCode);
      }
      if (params.errorMessage !== undefined) {
        sets.push(`"error_message" = ?`);
        bindings.push(params.errorMessage);
      }
      if (params.logFilesJson !== undefined) {
        sets.push(`"log_files" = ?`);
        bindings.push(params.logFilesJson);
      }
      if (params.startedAt !== undefined) {
        sets.push(`"started_at" = ?`);
        bindings.push(params.startedAt);
      }
      if (params.completedAt !== undefined) {
        sets.push(`"completed_at" = ?`);
        bindings.push(params.completedAt);
      }
      bindings.push(params.id);
      yield* Effect.promise(async () =>
        env.DB.prepare(`UPDATE "submissions" SET ${sets.join(", ")} WHERE "id" = ?`)
          .bind(...bindings)
          .run(),
      );
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(`DELETE FROM "submissions" WHERE "id" = ?`).bind(params.id).run(),
      );
    }),
});
