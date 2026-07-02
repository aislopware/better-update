-- Admit 'robot' into audit_logs.source. The auth middleware attributes robot
-- bearer actors with source = 'robot' (auth/middleware.ts) and the API contract
-- says session|robot, but the CHECK from 0008 predates robot accounts (0077) and
-- still allows only session|api-key — so EVERY audited robot action (credential
-- downloads, publishes, build uploads) dies on the logAudit insert with a 500,
-- which is exactly the CI path robots exist for. 'api-key' stays valid for
-- historical rows written before 0078 dropped that feature. SQLite cannot ALTER
-- a CHECK constraint in place, so rebuild the table (same rename -> create ->
-- copy -> drop -> reindex pattern as 0079_policy_attachment_robot_principal.sql).
ALTER TABLE "audit_logs" RENAME TO "audit_logs_old";

CREATE TABLE "audit_logs" (
  "id"              TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "project_id"      TEXT,
  "actor_id"        TEXT,
  "actor_email"     TEXT NOT NULL,
  "action"          TEXT NOT NULL,
  "resource_type"   TEXT NOT NULL,
  "resource_id"     TEXT,
  "metadata"        TEXT,
  "source"          TEXT NOT NULL CHECK ("source" IN ('session','api-key','robot')),
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO "audit_logs"
  ("id", "organization_id", "project_id", "actor_id", "actor_email", "action", "resource_type", "resource_id", "metadata", "source", "created_at")
SELECT "id", "organization_id", "project_id", "actor_id", "actor_email", "action", "resource_type", "resource_id", "metadata", "source", "created_at"
FROM "audit_logs_old";

DROP TABLE "audit_logs_old";

-- Recreate the cursor-pagination indexes exactly as 0028 left them.
CREATE INDEX "idx_audit_logs_org_created"
  ON "audit_logs" ("organization_id", "created_at" DESC, "id" DESC);

CREATE INDEX "idx_audit_logs_project"
  ON "audit_logs" ("organization_id", "project_id", "created_at" DESC, "id" DESC)
  WHERE "project_id" IS NOT NULL;

CREATE INDEX "idx_audit_logs_resource"
  ON "audit_logs" ("organization_id", "resource_type", "created_at" DESC, "id" DESC);
