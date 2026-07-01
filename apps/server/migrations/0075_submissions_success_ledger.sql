-- Collapse "submissions" into a success-only append ledger.
--
-- Store submissions run entirely client-side (CLI: xcrun altool for iOS, the
-- Google Play API for Android), so the server never owned the process — the
-- lifecycle status it stored was self-reported state that could get stuck
-- (e.g. an interrupted CLI leaving a row at IN_PROGRESS forever). A submission
-- row now exists iff a local upload actually succeeded: created once, never
-- patched. Drop the lifecycle columns (status, error_code, error_message,
-- log_files, queued_at, started_at, completed_at, updated_at) and keep only the
-- prior FINISHED history. SQLite cannot drop a CHECK-constrained column in
-- place, so rebuild the table: prune non-FINISHED rows, rename, recreate the
-- trimmed table, copy the survivors, drop the old table, recreate the indexes.

DELETE FROM "submissions" WHERE "status" != 'FINISHED';

ALTER TABLE "submissions" RENAME TO "submissions_old";

CREATE TABLE "submissions" (
    "id" TEXT PRIMARY KEY,
    "organization_id" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "project_id" TEXT NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "platform" TEXT NOT NULL CHECK ("platform" IN ('ios', 'android')),
    "profile_name" TEXT NOT NULL DEFAULT 'production',
    -- Archive source: 'build' | 'path' | 'url'. 'build' references the optional build_id.
    "archive_source" TEXT NOT NULL CHECK ("archive_source" IN ('build', 'path', 'url')),
    "build_id" TEXT REFERENCES "builds"("id") ON DELETE SET NULL,
    "archive_url" TEXT,
    -- Platform-specific submission config snapshot (see submission-models.ts).
    "submission_config" TEXT NOT NULL DEFAULT '{}',
    "initiating_user_id" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO "submissions"
  ("id", "organization_id", "project_id", "platform", "profile_name",
   "archive_source", "build_id", "archive_url", "submission_config",
   "initiating_user_id", "created_at")
SELECT
  "id", "organization_id", "project_id", "platform", "profile_name",
  "archive_source", "build_id", "archive_url", "submission_config",
  "initiating_user_id", "created_at"
FROM "submissions_old";

DROP TABLE "submissions_old";

CREATE INDEX "idx_submissions_project" ON "submissions"("project_id", "created_at" DESC);
CREATE INDEX "idx_submissions_org" ON "submissions"("organization_id", "created_at" DESC);
CREATE INDEX "idx_submissions_platform" ON "submissions"("project_id", "platform", "created_at" DESC);
CREATE INDEX "idx_submissions_build" ON "submissions"("build_id");
