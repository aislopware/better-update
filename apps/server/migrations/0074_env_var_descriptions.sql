-- Per-variable, non-secret documentation for environment variables (BU-14).
--
-- Env vars carry only key + encrypted value today, so a non-technical person
-- updating a value in the portal cannot tell what a given variable is for. This
-- table adds a human-readable label + description PER VARIABLE — keyed by
-- (scope, key), shared across every environment (dev/preview/prod are separate
-- env_vars rows for the same variable). It holds no secret: it describes the
-- variable, not its value, so it is editable from the portal without the vault.
--
-- Additive migration (no env_vars change): existing rows keep working; a variable
-- with no documentation simply has no row here and reads back as null label/desc.
CREATE TABLE "env_var_descriptions" (
  "id"              TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "project_id"      TEXT REFERENCES "projects"("id") ON DELETE CASCADE,
  "scope"           TEXT NOT NULL CHECK ("scope" IN ('project','global')),
  "key"             TEXT NOT NULL,
  "label"           TEXT,
  "description"     TEXT,
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    ("scope" = 'project' AND "project_id" IS NOT NULL) OR
    ("scope" = 'global'  AND "project_id" IS NULL)
  )
);

-- One documentation row per variable. Partial indexes mirror env_vars: a
-- project variable is unique by (project_id, key); a global one by
-- (organization_id, key) where project_id IS NULL.
CREATE UNIQUE INDEX "idx_env_var_desc_project_key"
  ON "env_var_descriptions"("project_id","key") WHERE "project_id" IS NOT NULL;
CREATE UNIQUE INDEX "idx_env_var_desc_global_key"
  ON "env_var_descriptions"("organization_id","key") WHERE "project_id" IS NULL;
CREATE INDEX "idx_env_var_desc_org" ON "env_var_descriptions"("organization_id");
