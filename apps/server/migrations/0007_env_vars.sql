CREATE TABLE "env_vars" (
  "id"               TEXT PRIMARY KEY,
  "organization_id"  TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "project_id"       TEXT NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "environment"      TEXT NOT NULL,
  "key"              TEXT NOT NULL,
  "visibility"       TEXT NOT NULL CHECK ("visibility" IN ('plaintext','sensitive','secret')),
  "value"            TEXT,
  "encrypted_value"  TEXT,
  "key_version"      INTEGER,
  "created_at"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX "idx_env_vars_unique" ON "env_vars"("project_id","environment","key");
CREATE INDEX "idx_env_vars_project_env" ON "env_vars"("project_id","environment");
CREATE INDEX "idx_env_vars_org" ON "env_vars"("organization_id");
