-- Org-wide project membership ("all projects", GITLAB-RBAC-SPEC §1): one row
-- grants the principal its `role` on EVERY project of the org — present AND
-- future — resolved at query time (max with the explicit project_member rows),
-- mirroring org_credential_binding (migration 0095). No per-project fan-out
-- writes; revoking the row falls back to whatever explicit rows exist.
-- Org owner/admin never hold rows here (implicit maintainers everywhere).
CREATE TABLE "org_project_member" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "principal_type"  TEXT NOT NULL CHECK ("principal_type" IN ('member')),
  "principal_id"    TEXT NOT NULL,
  "role"            TEXT NOT NULL CHECK ("role" IN ('maintainer', 'developer', 'reporter')),
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at"      TEXT,
  UNIQUE ("organization_id", "principal_type", "principal_id")
);
