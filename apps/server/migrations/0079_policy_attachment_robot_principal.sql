-- Swap the 'apikey' principal for 'robot' now that robot_account (0077)
-- replaces apikey (dropped in 0078) as the bearer-holding principal. SQLite
-- cannot ALTER a CHECK constraint in place, so rebuild the table (same
-- rename -> create -> copy -> drop -> reindex pattern as
-- 0075_submissions_success_ledger.sql).
DELETE FROM "policy_attachment" WHERE "principal_type" = 'apikey';

ALTER TABLE "policy_attachment" RENAME TO "policy_attachment_old";

CREATE TABLE "policy_attachment" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "policy_id"       TEXT NOT NULL,
  "principal_type"  TEXT NOT NULL CHECK ("principal_type" IN ('member', 'group', 'robot')),
  "principal_id"    TEXT NOT NULL,
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO "policy_attachment"
  ("id", "organization_id", "policy_id", "principal_type", "principal_id", "created_at")
SELECT "id", "organization_id", "policy_id", "principal_type", "principal_id", "created_at"
FROM "policy_attachment_old";

DROP TABLE "policy_attachment_old";

-- Resolution lookup: every attachment for a principal.
CREATE INDEX "idx_policy_attachment_principal"
  ON "policy_attachment" ("principal_type", "principal_id");
-- Reverse lookup + cascade hygiene on policy delete.
CREATE INDEX "idx_policy_attachment_policy" ON "policy_attachment" ("policy_id");
-- One attachment per (org, policy, principal). Org-scoped so a foreign-org
-- robot id (accepted as-is at attach time) cannot occupy another org's slot.
CREATE UNIQUE INDEX "idx_policy_attachment_unique"
  ON "policy_attachment" ("organization_id", "policy_id", "principal_type", "principal_id");
