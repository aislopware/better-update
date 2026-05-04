-- Add composite cursor indexes for branches + channels list endpoints.
-- Cursor encodes (created_at, id); query uses (created_at, id) keyset comparison
-- and ORDER BY created_at DESC, id DESC. Trailing id keeps the index covering.
--
-- Branches had no per-project sort index before — list scanned by project_id
-- then sorted in memory. Channels had only (branch_id, project_id) which doesn't
-- help the project-list query at all.

CREATE INDEX "idx_branches_project_created"
  ON "branches" ("project_id", "created_at" DESC, "id" DESC);

CREATE INDEX "idx_channels_project_created"
  ON "channels" ("project_id", "created_at" DESC, "id" DESC);
