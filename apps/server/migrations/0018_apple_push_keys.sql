CREATE TABLE "apple_push_keys" (
  "id"               TEXT PRIMARY KEY,
  "organization_id"  TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "apple_team_id"    TEXT NOT NULL REFERENCES "apple_teams"("id") ON DELETE CASCADE,
  "key_id"           TEXT NOT NULL,
  "r2_key"           TEXT NOT NULL,
  "encrypted_dek"    TEXT NOT NULL,
  "dek_key_version"  INTEGER NOT NULL,
  "created_at"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX "idx_push_keys_org_keyid" ON "apple_push_keys"("organization_id", "key_id");
CREATE INDEX "idx_push_keys_team" ON "apple_push_keys"("apple_team_id");
CREATE INDEX "idx_push_keys_org" ON "apple_push_keys"("organization_id");
