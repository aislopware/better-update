DROP INDEX IF EXISTS "idx_env_vars_unique";
DROP INDEX IF EXISTS "idx_env_vars_project_env";
DROP INDEX IF EXISTS "idx_env_vars_org";
DROP TABLE IF EXISTS "env_vars";

CREATE TABLE "env_vars" (
  "id"               TEXT PRIMARY KEY,
  "organization_id"  TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "project_id"       TEXT REFERENCES "projects"("id") ON DELETE CASCADE,
  "scope"            TEXT NOT NULL CHECK ("scope" IN ('project','global')),
  "key"              TEXT NOT NULL,
  "visibility"       TEXT NOT NULL CHECK ("visibility" IN ('plaintext','sensitive')),
  "value"            TEXT,
  "encrypted_value"  TEXT,
  "key_version"      INTEGER,
  "created_at"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    ("scope" = 'project' AND "project_id" IS NOT NULL) OR
    ("scope" = 'global'  AND "project_id" IS NULL)
  )
);

CREATE UNIQUE INDEX "idx_env_vars_project_key"
  ON "env_vars"("project_id","key") WHERE "project_id" IS NOT NULL;
CREATE UNIQUE INDEX "idx_env_vars_global_key"
  ON "env_vars"("organization_id","key") WHERE "project_id" IS NULL;
CREATE INDEX "idx_env_vars_org" ON "env_vars"("organization_id");

CREATE TABLE "env_var_environments" (
  "env_var_id"   TEXT NOT NULL REFERENCES "env_vars"("id") ON DELETE CASCADE,
  "environment"  TEXT NOT NULL CHECK ("environment" IN ('development','preview','production')),
  PRIMARY KEY ("env_var_id", "environment")
);
CREATE INDEX "idx_env_var_environments_env" ON "env_var_environments"("environment");
