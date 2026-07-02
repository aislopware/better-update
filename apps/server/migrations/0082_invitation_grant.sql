-- Access grants applied when an invitation is accepted
-- (docs/specs/authz/ROLES-CAPABILITIES-SPEC.md §8d). policy_id follows the
-- same grammar as policy_attachment.policy_id (managed, parameterized managed,
-- or real policy id). Rows are consumed (deleted) on accept. No FK to
-- better-auth's "invitation" table (its lifecycle is plugin-managed); rows are
-- swept app-side on accept and on invitation cancel/expiry.
CREATE TABLE "invitation_grant" (
  "invitation_id"   TEXT NOT NULL,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "policy_id"       TEXT NOT NULL,
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY ("invitation_id", "policy_id")
);
