-- Environment variables become end-to-end encrypted + versioned, mirroring the
-- credential vault (see docs/specs/build/03-environment-variables.md). Values are
-- no longer stored plaintext: each (scope,key,environment) env var keeps a history
-- of encrypted revisions, and the active value is whichever revision
-- "current_revision_id" points at. Each revision carries a wrapped DEK +
-- vault_version and participates in org vault rotation exactly like a credential.
--
-- Destructive recreate (same pattern as 0048): plaintext values cannot be migrated
-- to E2E (the server holds no vault key), and there are no production rows to
-- preserve. Local/dev env-var data is reset; re-set via the CLI after deploy.
DROP INDEX IF EXISTS "idx_env_vars_project_key_env";
DROP INDEX IF EXISTS "idx_env_vars_global_key_env";
DROP INDEX IF EXISTS "idx_env_vars_org";
DROP INDEX IF EXISTS "idx_env_vars_env";
DROP TABLE IF EXISTS "env_var_revisions";
DROP TABLE IF EXISTS "env_vars";

-- Metadata row: server-visible, holds no secret value. The active value lives in
-- the revision pointed at by "current_revision_id" (nullable only transiently,
-- between inserting the metadata row and its first revision).
CREATE TABLE "env_vars" (
  "id"                  TEXT PRIMARY KEY,
  "organization_id"     TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "project_id"          TEXT REFERENCES "projects"("id") ON DELETE CASCADE,
  "scope"               TEXT NOT NULL CHECK ("scope" IN ('project','global')),
  "environment"         TEXT NOT NULL CHECK ("environment" IN ('development','preview','production')),
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

-- Encrypted value history. Each row is one E2E-encrypted value: the typed payload
-- (XChaCha20-Poly1305 ciphertext, base64) plus its DEK wrapped under the org vault
-- key (base64) at "vault_version". "organization_id" is denormalized so vault
-- rotation can re-wrap every revision with a single org-scoped predicate (no join).
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
