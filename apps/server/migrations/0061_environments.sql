-- User-defined environments + built-in lock for branches/channels.
--
-- Environment becomes a first-class, org-scoped concept. The three built-ins
-- (development, preview, production) stay VIRTUAL — they are never stored as
-- rows; the API merges them in front of the user-defined rows below. So this
-- table holds ONLY user-defined (custom) environments.
CREATE TABLE "environments" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "name"            TEXT NOT NULL,
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE ("organization_id", "name")
);

CREATE INDEX "idx_environments_org" ON "environments" ("organization_id");

-- Built-in flag for branches/channels: the three built-ins seeded on project
-- create cannot be renamed or deleted (operational actions stay allowed).
ALTER TABLE "branches" ADD COLUMN "is_builtin" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "channels" ADD COLUMN "is_builtin" INTEGER NOT NULL DEFAULT 0;

-- Backfill: mark existing branches/channels named after a built-in as built-in.
-- Legacy projects seeded "staging" stay user-defined (renamable/deletable).
UPDATE "branches"
  SET "is_builtin" = 1
  WHERE "name" IN ('development', 'preview', 'production');
UPDATE "channels"
  SET "is_builtin" = 1
  WHERE "name" IN ('development', 'preview', 'production');

-- Drop the env_vars.environment CHECK enum so any org environment (built-in or
-- user-defined) is a valid value; validation moves to the application layer.
-- SQLite cannot ALTER a CHECK, so we recreate env_vars (and its FK-child
-- env_var_revisions). Destructive recreate, same pattern as 0048/0049: env var
-- values are E2E-encrypted (the server holds no vault key) and there are no
-- production rows to preserve. Local/dev env-var data is reset; re-set via CLI.
DROP INDEX IF EXISTS "idx_env_var_revisions_env_num";
DROP INDEX IF EXISTS "idx_env_var_revisions_org";
DROP INDEX IF EXISTS "idx_env_vars_project_key_env";
DROP INDEX IF EXISTS "idx_env_vars_global_key_env";
DROP INDEX IF EXISTS "idx_env_vars_org";
DROP INDEX IF EXISTS "idx_env_vars_env";
DROP TABLE IF EXISTS "env_var_revisions";
DROP TABLE IF EXISTS "env_vars";

CREATE TABLE "env_vars" (
  "id"                  TEXT PRIMARY KEY,
  "organization_id"     TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "project_id"          TEXT REFERENCES "projects"("id") ON DELETE CASCADE,
  "scope"               TEXT NOT NULL CHECK ("scope" IN ('project','global')),
  "environment"         TEXT NOT NULL,
  "key"                 TEXT NOT NULL,
  "visibility"          TEXT NOT NULL CHECK ("visibility" IN ('plaintext','sensitive')),
  "current_revision_id" TEXT,
  "created_at"          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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

CREATE TABLE "env_var_revisions" (
  "id"                 TEXT PRIMARY KEY,
  "env_var_id"         TEXT NOT NULL REFERENCES "env_vars"("id") ON DELETE CASCADE,
  "organization_id"    TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "revision_number"    INTEGER NOT NULL,
  "value_ciphertext"   TEXT NOT NULL,
  "wrapped_dek"        TEXT NOT NULL,
  "vault_version"      INTEGER NOT NULL,
  "created_by_user_id" TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at"         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX "idx_env_var_revisions_env_num"
  ON "env_var_revisions"("env_var_id","revision_number");
CREATE INDEX "idx_env_var_revisions_org" ON "env_var_revisions"("organization_id");
