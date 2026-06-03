-- Per-scope ABAC permission grants. v1 scope_kind = 'channel' only (column kept
-- generic so 'branch'/'env_var_environment' can extend later without a migration).
-- effect IN ('allow','deny') with deny winning in resolution. actions = JSON array
-- of "resource:action" strings, e.g. '["update:create","rollout:update"]'.
-- See docs/specs/authz/SPEC.md section 7.

CREATE TABLE "environment_grant" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "member_id"       TEXT NOT NULL REFERENCES "member" ("id") ON DELETE CASCADE,
  "scope_kind"      TEXT NOT NULL CHECK ("scope_kind" IN ('channel')),
  "scope_id"        TEXT NOT NULL,
  "effect"          TEXT NOT NULL CHECK ("effect" IN ('allow', 'deny')),
  "actions"         TEXT NOT NULL,
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Resolution lookup: a member's grants on a specific scope object.
CREATE INDEX "idx_environment_grant_member_scope"
  ON "environment_grant" ("member_id", "scope_kind", "scope_id");

-- Scope-side sweep: revoke all grants when a channel is deleted.
CREATE INDEX "idx_environment_grant_scope"
  ON "environment_grant" ("scope_kind", "scope_id");

-- One row per (member, scope, effect): the upsert target. Action-level merge
-- happens inside the JSON array, enforced by the application.
CREATE UNIQUE INDEX "idx_environment_grant_unique"
  ON "environment_grant" ("member_id", "scope_kind", "scope_id", "effect");
