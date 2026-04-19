-- Add project_id column so audit logs can be filtered per project (activity feed).
-- Backfill existing rows by joining resource_id to each resource table.

ALTER TABLE "audit_logs" ADD COLUMN "project_id" TEXT;

UPDATE "audit_logs"
SET "project_id" = "resource_id"
WHERE "resource_type" = 'project' AND "project_id" IS NULL;

UPDATE "audit_logs"
SET "project_id" = (SELECT "project_id" FROM "builds" WHERE "id" = "audit_logs"."resource_id")
WHERE "resource_type" = 'build' AND "project_id" IS NULL;

UPDATE "audit_logs"
SET "project_id" = (SELECT "project_id" FROM "branches" WHERE "id" = "audit_logs"."resource_id")
WHERE "resource_type" = 'branch' AND "project_id" IS NULL;

UPDATE "audit_logs"
SET "project_id" = (SELECT "project_id" FROM "channels" WHERE "id" = "audit_logs"."resource_id")
WHERE "resource_type" = 'channel' AND "project_id" IS NULL;

UPDATE "audit_logs"
SET "project_id" = (
  SELECT "b"."project_id"
  FROM "updates" "u"
  JOIN "branches" "b" ON "u"."branch_id" = "b"."id"
  WHERE "u"."id" = "audit_logs"."resource_id"
)
WHERE "resource_type" = 'update' AND "project_id" IS NULL;

UPDATE "audit_logs"
SET "project_id" = (SELECT "project_id" FROM "env_vars" WHERE "id" = "audit_logs"."resource_id")
WHERE "resource_type" = 'envVar' AND "project_id" IS NULL;

UPDATE "audit_logs"
SET "project_id" = (SELECT "project_id" FROM "credentials" WHERE "id" = "audit_logs"."resource_id")
WHERE "resource_type" = 'credential' AND "project_id" IS NULL;

CREATE INDEX "idx_audit_logs_project" ON "audit_logs" ("organization_id", "project_id", "created_at" DESC)
  WHERE "project_id" IS NOT NULL;
