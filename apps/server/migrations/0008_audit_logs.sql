CREATE TABLE "audit_logs" (
  "id"              TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "actor_id"        TEXT,
  "actor_email"     TEXT NOT NULL,
  "action"          TEXT NOT NULL,
  "resource_type"   TEXT NOT NULL,
  "resource_id"     TEXT,
  "metadata"        TEXT,
  "source"          TEXT NOT NULL CHECK ("source" IN ('session','api-key')),
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX "idx_audit_logs_org_created" ON "audit_logs"("organization_id", "created_at" DESC);
CREATE INDEX "idx_audit_logs_action" ON "audit_logs"("organization_id", "action");
CREATE INDEX "idx_audit_logs_actor" ON "audit_logs"("organization_id", "actor_id");
CREATE INDEX "idx_audit_logs_resource" ON "audit_logs"("organization_id", "resource_type", "resource_id");
