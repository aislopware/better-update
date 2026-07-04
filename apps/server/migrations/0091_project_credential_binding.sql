-- Credential→project bindings (GITLAB-RBAC-SPEC §1a/§3c, v2). Org-scoped
-- credentials are usable in a project ONLY when bound to it:
--   appleTeam                — binds the team row; cascades to every child
--                              credential AND the team's registered devices
--   ascApiKey                — team-less ASC keys only (no team to ride on)
--   googleServiceAccountKey  — per-row
--   androidUploadKeystore    — per-row
-- No backfill: existing credentials start UNBOUND (admin-only) and the owner
-- binds by hand post-deploy (owner decision 2026-07-03, authz compat waiver).
CREATE TABLE "project_credential_binding" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "project_id"      TEXT NOT NULL REFERENCES "projects" ("id") ON DELETE CASCADE,
  "resource_type"   TEXT NOT NULL CHECK ("resource_type" IN
    ('appleTeam', 'ascApiKey', 'googleServiceAccountKey', 'androidUploadKeystore')),
  "resource_id"     TEXT NOT NULL,
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE ("project_id", "resource_type", "resource_id")
);

-- List-filter path: all bindings of one org's resource; project detail path:
-- all bindings of one project (covered by the UNIQUE index prefix).
CREATE INDEX "idx_project_credential_binding_resource"
  ON "project_credential_binding" ("organization_id", "resource_type", "resource_id");
