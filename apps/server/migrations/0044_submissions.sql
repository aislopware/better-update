-- Store-submission state machine, mirroring EAS submit lifecycle:
--   AWAITING_BUILD -> IN_QUEUE -> IN_PROGRESS -> FINISHED | ERRORED | CANCELED
-- iOS submissions are orchestrated client-side (xcrun altool on user's Mac) — the
-- server records intent + status patches. Android submissions are server-driven
-- via Google Play androidpublisher API.

CREATE TABLE "submissions" (
    "id" TEXT PRIMARY KEY,
    "organization_id" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "project_id" TEXT NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "platform" TEXT NOT NULL CHECK ("platform" IN ('ios', 'android')),
    "profile_name" TEXT NOT NULL DEFAULT 'production',
    "status" TEXT NOT NULL CHECK ("status" IN (
        'AWAITING_BUILD', 'IN_QUEUE', 'IN_PROGRESS',
        'FINISHED', 'ERRORED', 'CANCELED'
    )),
    -- Archive source: 'build' | 'path' | 'url'. 'build' references the optional build_id.
    "archive_source" TEXT NOT NULL CHECK ("archive_source" IN ('build', 'path', 'url')),
    "build_id" TEXT REFERENCES "builds"("id") ON DELETE SET NULL,
    "archive_url" TEXT,
    -- Platform-specific submission config (snapshot from eas.json submit profile).
    -- iOS: { appleId, ascAppId, appleTeamId, sku, language, companyName, appName,
    --        bundleIdentifier, ascApiKeyId, ascApiKeyIdentifier, ascApiKeyIssuerId,
    --        groups, whatToTest }
    -- Android: { applicationId, track, releaseStatus, changesNotSentForReview,
    --            rollout, googleServiceAccountKeyId }
    "submission_config" TEXT NOT NULL DEFAULT '{}',
    -- Terminal error info: { errorCode, message }
    "error_code" TEXT,
    "error_message" TEXT,
    -- JSON array of signed log file URLs (R2-hosted). Mirrors EAS `logFiles[]`.
    "log_files" TEXT NOT NULL DEFAULT '[]',
    "initiating_user_id" TEXT,
    "queued_at" TEXT,
    "started_at" TEXT,
    "completed_at" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX "idx_submissions_project" ON "submissions"("project_id", "created_at" DESC);
CREATE INDEX "idx_submissions_org" ON "submissions"("organization_id", "created_at" DESC);
CREATE INDEX "idx_submissions_status" ON "submissions"("project_id", "status", "created_at" DESC);
CREATE INDEX "idx_submissions_platform" ON "submissions"("project_id", "platform", "created_at" DESC);
CREATE INDEX "idx_submissions_build" ON "submissions"("build_id");
