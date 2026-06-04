-- A reusable, named permission document. `document` is JSON:
--   { "statements": [ { "effect": "allow"|"deny",
--                       "actions": ["update:create","channel:*","*"],
--                       "resources": ["project/A","project/*/env/production","*"] } ] }
-- Managed presets (admin/developer/viewer) are virtual (code-defined) and are NOT
-- stored here. See docs/specs/authz/POLICY-GROUPS-SPEC.md §1, §5.
CREATE TABLE "policy" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "name"            TEXT NOT NULL,
  "description"     TEXT,
  "document"        TEXT NOT NULL,
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at"      TEXT
);
CREATE INDEX "idx_policy_org" ON "policy" ("organization_id");
CREATE UNIQUE INDEX "idx_policy_org_name" ON "policy" ("organization_id", "name");
