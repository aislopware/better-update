-- Links a policy (real row id OR a "managed:*" preset id) to a principal.
-- policy_id has NO FK: managed preset ids are virtual (code-defined). Deleting a
-- real policy sweeps its attachments app-side (PolicyRepo.delete).
CREATE TABLE "policy_attachment" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "policy_id"       TEXT NOT NULL,
  "principal_type"  TEXT NOT NULL CHECK ("principal_type" IN ('member', 'group', 'apikey')),
  "principal_id"    TEXT NOT NULL,
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- Resolution lookup: every attachment for a principal.
CREATE INDEX "idx_policy_attachment_principal"
  ON "policy_attachment" ("principal_type", "principal_id");
-- Reverse lookup + cascade hygiene on policy delete.
CREATE INDEX "idx_policy_attachment_policy" ON "policy_attachment" ("policy_id");
-- One attachment per (org, policy, principal). Org-scoped so a foreign-org api-key
-- id (accepted as-is at attach time) cannot occupy another org's slot.
CREATE UNIQUE INDEX "idx_policy_attachment_unique"
  ON "policy_attachment" ("organization_id", "policy_id", "principal_type", "principal_id");
