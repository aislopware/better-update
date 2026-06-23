-- Reversible project archival. `archived_at` NULL = active; an ISO-8601 timestamp
-- = archived (read-only). Archived projects are hidden from the default project
-- list but stay fully readable and restorable. While archived, every
-- project-scoped write (publish, build, env, rename, channel/branch mutations…) is
-- blocked at the authz gate (assertAccess) with 403; unarchive + delete remain
-- allowed. OTA serving to devices is unaffected. Additive, nullable column — keeps
-- the live mixed-version CLI/server fleet backward compatible.
ALTER TABLE "projects" ADD COLUMN "archived_at" TEXT;

-- Speeds the org-scoped active/archived split the list view filters on.
CREATE INDEX "idx_projects_org_archived" ON "projects" ("organization_id", "archived_at");
