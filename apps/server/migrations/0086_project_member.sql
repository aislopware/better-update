-- GitLab-style RBAC (docs/specs/authz/GITLAB-RBAC-SPEC.md §4a).
-- Per-project membership for humans AND robots: one row per principal per
-- project, carrying the fixed project role. Org owner/admin never need rows
-- (implicit maintainer everywhere); org members see ONLY projects where they
-- hold a row.
CREATE TABLE "project_member" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "project_id"      TEXT NOT NULL REFERENCES "projects" ("id") ON DELETE CASCADE,
  "principal_type"  TEXT NOT NULL CHECK ("principal_type" IN ('member', 'robot')),
  "principal_id"    TEXT NOT NULL,
  "role"            TEXT NOT NULL CHECK ("role" IN ('maintainer', 'developer', 'reporter')),
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at"      TEXT
);

CREATE UNIQUE INDEX "idx_project_member_unique"
  ON "project_member" ("project_id", "principal_type", "principal_id");
CREATE INDEX "idx_project_member_principal"
  ON "project_member" ("organization_id", "principal_type", "principal_id");

-- Backfill 1: holders of a managed:admin attachment become org admins.
-- (policy_attachment still exists here; it is dropped in a later migration.)
UPDATE "member" SET "role" = 'admin'
WHERE "role" <> 'owner'
  AND "id" IN (
    SELECT "principal_id" FROM "policy_attachment"
    WHERE "policy_id" = 'managed:admin' AND "principal_type" = 'member'
  );

-- Backfill 2: every remaining plain member gets a developer row on every
-- project of their org, so nobody is locked out on deploy day. The owner
-- prunes/adjusts by hand afterwards (accepted decision, spec header).
INSERT INTO "project_member" ("id", "organization_id", "project_id", "principal_type", "principal_id", "role")
SELECT
  lower(hex(randomblob(16))),
  "member"."organization_id",
  "projects"."id",
  'member',
  "member"."id",
  'developer'
FROM "member"
JOIN "projects" ON "projects"."organization_id" = "member"."organization_id"
WHERE "member"."role" NOT IN ('owner', 'admin');
