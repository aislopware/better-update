-- Recreate audit_logs indexes with id tie-breaker for stable cursor pagination.
-- Cursor encodes (created_at, id); query uses (created_at, id) keyset comparison
-- and ORDER BY created_at DESC, id DESC. Trailing id keeps the index covering.

DROP INDEX IF EXISTS "idx_audit_logs_org_created";
DROP INDEX IF EXISTS "idx_audit_logs_project";
DROP INDEX IF EXISTS "idx_audit_logs_resource";
DROP INDEX IF EXISTS "idx_audit_logs_action";
DROP INDEX IF EXISTS "idx_audit_logs_actor";

CREATE INDEX "idx_audit_logs_org_created"
  ON "audit_logs" ("organization_id", "created_at" DESC, "id" DESC);

CREATE INDEX "idx_audit_logs_project"
  ON "audit_logs" ("organization_id", "project_id", "created_at" DESC, "id" DESC)
  WHERE "project_id" IS NOT NULL;

CREATE INDEX "idx_audit_logs_resource"
  ON "audit_logs" ("organization_id", "resource_type", "created_at" DESC, "id" DESC);
