-- An invitation may carry an org-wide ("all projects") membership grant, the
-- invitation analog of org_project_member (migration 0097): accepting
-- materializes the row as an org_project_member row for the new member, so the
-- role applies to every project — present AND future. At most one row per
-- invitation. Same lifecycle as invitation_project_grant (migration 0087):
-- validated against the INVITER at create time, swept on accept/cancel/reject.
-- No FK to better-auth's "invitation" (better-auth owns that table's lifecycle).
CREATE TABLE "invitation_org_project_grant" (
  "invitation_id"   TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "role"            TEXT NOT NULL CHECK ("role" IN ('maintainer', 'developer', 'reporter')),
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX "idx_invitation_org_project_grant_org"
  ON "invitation_org_project_grant" ("organization_id");
