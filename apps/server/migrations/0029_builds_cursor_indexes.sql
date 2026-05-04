-- Recreate builds indexes with id tie-breaker for stable cursor pagination.
-- Cursor encodes (created_at, id); query uses (created_at, id) keyset comparison
-- and ORDER BY created_at DESC, id DESC. Trailing id keeps the index covering.

DROP INDEX IF EXISTS "idx_builds_project";
DROP INDEX IF EXISTS "idx_builds_platform";

CREATE INDEX "idx_builds_project"
  ON "builds" ("project_id", "created_at" DESC, "id" DESC);

CREATE INDEX "idx_builds_platform"
  ON "builds" ("project_id", "platform", "created_at" DESC, "id" DESC);
