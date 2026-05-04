-- Materialize "projects.last_activity_at" so list/sort queries no longer scan
-- updates+branches via correlated subquery. Backfill from MAX(updates.created_at)
-- joined through branches; fallback to projects.created_at when there are no
-- updates yet. Maintained going forward by application use cases on insert
-- (update / build / branch / channel).
--
-- Indexes:
--   idx_projects_org_activity: covers default sort (lastActivityAt DESC) with
--     id DESC tie-breaker so offset pagination is stable.
--   idx_projects_org_name: covers alternative sort (name ASC) with id ASC
--     tie-breaker. NOCASE collation matches case-insensitive ordering shown in
--     the dashboard.

ALTER TABLE "projects" ADD COLUMN "last_activity_at" TEXT;

UPDATE "projects" SET "last_activity_at" = COALESCE(
  (
    SELECT MAX("updates"."created_at")
    FROM "updates"
    JOIN "branches" ON "branches"."id" = "updates"."branch_id"
    WHERE "branches"."project_id" = "projects"."id"
  ),
  "projects"."created_at"
);

CREATE INDEX "idx_projects_org_activity"
  ON "projects" ("organization_id", "last_activity_at" DESC, "id" DESC);

CREATE INDEX "idx_projects_org_name"
  ON "projects" ("organization_id", "name" COLLATE NOCASE, "id");
