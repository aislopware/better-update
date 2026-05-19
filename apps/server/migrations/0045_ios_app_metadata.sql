-- App Store Connect metadata, keyed by project + bundle identifier.
-- Captures the fields EAS submit auto-creates / validates in the ASC API:
--   ascAppId   — numeric app id in App Store Connect (set after first submit)
--   sku        — internal unique identifier (only used on first-time app create)
--   language   — primary App Store language (default 'en-US')
--   companyName — only required for first submission to App Store
--   appName    — app name shown in ASC (defaults from app.json)
-- All fields nullable so a user can seed metadata progressively.

CREATE TABLE "ios_app_metadata" (
    "id" TEXT PRIMARY KEY,
    "organization_id" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "project_id" TEXT NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "bundle_identifier" TEXT NOT NULL,
    "asc_app_id" TEXT,
    "sku" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en-US',
    "company_name" TEXT,
    "app_name" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX "idx_ios_app_metadata_unique" ON "ios_app_metadata"("project_id", "bundle_identifier");
CREATE INDEX "idx_ios_app_metadata_org" ON "ios_app_metadata"("organization_id");
