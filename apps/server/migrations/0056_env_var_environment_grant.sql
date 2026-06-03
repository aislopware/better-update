-- Widen the environment_grant.scope_kind CHECK to admit 'env_var_environment'
-- alongside the original 'channel'. SQLite cannot ALTER a CHECK constraint, so we
-- rebuild the table: rename → recreate (same columns/FKs/default as 0055, new
-- CHECK) → copy rows → drop old → recreate all three indexes.
-- See docs/specs/authz/env-grants-SPEC.md section 4.

ALTER TABLE "environment_grant" RENAME TO "environment_grant_old";

CREATE TABLE "environment_grant" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "member_id"       TEXT NOT NULL REFERENCES "member" ("id") ON DELETE CASCADE,
  "scope_kind"      TEXT NOT NULL CHECK ("scope_kind" IN ('channel', 'env_var_environment')),
  "scope_id"        TEXT NOT NULL,
  "effect"          TEXT NOT NULL CHECK ("effect" IN ('allow', 'deny')),
  "actions"         TEXT NOT NULL,
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO "environment_grant"
  ("id", "organization_id", "member_id", "scope_kind", "scope_id", "effect", "actions", "created_at")
SELECT
  "id", "organization_id", "member_id", "scope_kind", "scope_id", "effect", "actions", "created_at"
FROM "environment_grant_old";

DROP TABLE "environment_grant_old";

-- Recreate all three indexes from 0055 (identical definitions).
CREATE INDEX "idx_environment_grant_member_scope"
  ON "environment_grant" ("member_id", "scope_kind", "scope_id");

CREATE INDEX "idx_environment_grant_scope"
  ON "environment_grant" ("scope_kind", "scope_id");

CREATE UNIQUE INDEX "idx_environment_grant_unique"
  ON "environment_grant" ("member_id", "scope_kind", "scope_id", "effect");
