CREATE TABLE "apple_teams" (
  "id"               TEXT PRIMARY KEY,
  "organization_id"  TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "apple_team_id"    TEXT NOT NULL,
  "apple_team_type"  TEXT NOT NULL CHECK ("apple_team_type" IN ('IN_HOUSE','COMPANY_ORGANIZATION','INDIVIDUAL')),
  "name"             TEXT,
  "created_at"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX "idx_apple_teams_org_teamid" ON "apple_teams"("organization_id", "apple_team_id");
CREATE INDEX "idx_apple_teams_org" ON "apple_teams"("organization_id");
