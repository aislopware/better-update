-- Org-wide credential bindings (GITLAB-RBAC-SPEC §1a, "all projects"). A row
-- here binds the resource to EVERY project of the org — present AND future —
-- resolved at query time (union with project_credential_binding rows), so a
-- newly created project is covered without any per-project fan-out writes.
-- Same resource kinds and cascade semantics as project_credential_binding.
CREATE TABLE "org_credential_binding" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "resource_type"   TEXT NOT NULL CHECK ("resource_type" IN
    ('appleTeam', 'ascApiKey', 'googleServiceAccountKey', 'androidUploadKeystore')),
  "resource_id"     TEXT NOT NULL,
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE ("organization_id", "resource_type", "resource_id")
);
