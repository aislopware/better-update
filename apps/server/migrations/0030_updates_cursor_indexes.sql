-- Cursor pagination on /api/updates uses (created_at, id) keyset on
-- (branch_id, created_at DESC, id DESC). idx_updates_resolution covers the
-- prefix (branch_id, platform, runtime_version, ...) which the planner cannot
-- use efficiently for branch-only seeks; this index gives a clean covering
-- index for the cursor case (no platform filter).

CREATE INDEX IF NOT EXISTS "idx_updates_branch_created"
  ON "updates" ("branch_id", "created_at" DESC, "id" DESC);
