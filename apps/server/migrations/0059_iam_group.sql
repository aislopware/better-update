-- A named collection of members. Policies attach to a group; its members inherit
-- them. Table is prefixed `iam_` because `group` is a SQL reserved word.
CREATE TABLE "iam_group" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "name"            TEXT NOT NULL,
  "description"     TEXT,
  "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at"      TEXT
);
CREATE INDEX "idx_iam_group_org" ON "iam_group" ("organization_id");
CREATE UNIQUE INDEX "idx_iam_group_org_name" ON "iam_group" ("organization_id", "name");

CREATE TABLE "iam_group_membership" (
  "group_id"   TEXT NOT NULL REFERENCES "iam_group" ("id") ON DELETE CASCADE,
  "member_id"  TEXT NOT NULL REFERENCES "member" ("id") ON DELETE CASCADE,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("group_id", "member_id")
);
-- Resolve a member's groups in one indexed read.
CREATE INDEX "idx_iam_group_membership_member" ON "iam_group_membership" ("member_id");
