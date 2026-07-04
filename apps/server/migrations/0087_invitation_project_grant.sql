-- GitLab-style RBAC (docs/specs/authz/GITLAB-RBAC-SPEC.md §4a). An invitation
-- may carry project grants; accepting materializes them as project_member
-- rows. Successor of invitation_grant (policy ids), which is dropped in a
-- later migration. No FK to better-auth's "invitation" (same reasoning as
-- invitation_grant: better-auth owns that table's lifecycle).
CREATE TABLE "invitation_project_grant" (
  "invitation_id"   TEXT NOT NULL,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "project_id"      TEXT NOT NULL REFERENCES "projects" ("id") ON DELETE CASCADE,
  "role"            TEXT NOT NULL CHECK ("role" IN ('maintainer', 'developer', 'reporter')),
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("invitation_id", "project_id")
);

CREATE INDEX "idx_invitation_project_grant_org"
  ON "invitation_project_grant" ("organization_id");
