-- Move env vars from "one row per (scope,key) linked to many environments via
-- env_var_environments" to "one row per (scope,key,environment)" so the same key
-- can hold different values per environment (Expo-style). Uniqueness becomes
-- (scope, key, environment).
--
-- Destructive recreate (same pattern as 0037): there is no automatic way to split
-- a single shared value into per-environment values, and there are no production
-- rows to preserve. Local/dev env-var data is reset.
DROP INDEX IF EXISTS "idx_env_var_environments_env";
DROP INDEX IF EXISTS "idx_env_vars_project_key";
DROP INDEX IF EXISTS "idx_env_vars_global_key";
DROP INDEX IF EXISTS "idx_env_vars_org";
DROP TABLE IF EXISTS "env_var_environments";
DROP TABLE IF EXISTS "env_vars";

CREATE TABLE "env_vars" (
  "id"               TEXT PRIMARY KEY,
  "organization_id"  TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "project_id"       TEXT REFERENCES "projects"("id") ON DELETE CASCADE,
  "scope"            TEXT NOT NULL CHECK ("scope" IN ('project','global')),
  "environment"      TEXT NOT NULL CHECK ("environment" IN ('development','preview','production')),
  "key"              TEXT NOT NULL,
  "visibility"       TEXT NOT NULL CHECK ("visibility" IN ('plaintext','sensitive')),
  "value"            TEXT,
  "created_at"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    ("scope" = 'project' AND "project_id" IS NOT NULL) OR
    ("scope" = 'global'  AND "project_id" IS NULL)
  )
);

CREATE UNIQUE INDEX "idx_env_vars_project_key_env"
  ON "env_vars"("project_id","key","environment") WHERE "project_id" IS NOT NULL;
CREATE UNIQUE INDEX "idx_env_vars_global_key_env"
  ON "env_vars"("organization_id","key","environment") WHERE "project_id" IS NULL;
CREATE INDEX "idx_env_vars_org" ON "env_vars"("organization_id");
CREATE INDEX "idx_env_vars_env" ON "env_vars"("environment");
