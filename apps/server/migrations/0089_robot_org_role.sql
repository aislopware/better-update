-- Robot org role (docs/specs/authz/GITLAB-RBAC-SPEC.md §1b). Robots use the
-- same two authz layers as humans: an org role ('admin' = implicit maintainer
-- everywhere + org management reads, 'member' = only what project_member rows
-- grant) plus project_member rows with principal_type='robot'.
ALTER TABLE "robot_account" ADD COLUMN "org_role" TEXT NOT NULL DEFAULT 'member'
  CHECK ("org_role" IN ('admin', 'member'));

-- Backfill: robots holding managed:admin become admin robots; every other
-- live robot gets developer rows on all org projects (prune by hand after
-- deploy — same story as member backfill in 0086).
UPDATE "robot_account" SET "org_role" = 'admin'
WHERE "id" IN (
  SELECT "principal_id" FROM "policy_attachment"
  WHERE "policy_id" = 'managed:admin' AND "principal_type" = 'robot'
);

INSERT INTO "project_member" ("id", "organization_id", "project_id", "principal_type", "principal_id", "role")
SELECT
  lower(hex(randomblob(16))),
  "robot_account"."organization_id",
  "projects"."id",
  'robot',
  "robot_account"."id",
  'developer'
FROM "robot_account"
JOIN "projects" ON "projects"."organization_id" = "robot_account"."organization_id"
WHERE "robot_account"."revoked_at" IS NULL
  AND "robot_account"."org_role" = 'member';
