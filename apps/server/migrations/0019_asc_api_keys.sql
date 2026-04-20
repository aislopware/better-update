CREATE TABLE "asc_api_keys" (
  "id"                     TEXT PRIMARY KEY,
  "organization_id"        TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "apple_team_id"          TEXT REFERENCES "apple_teams"("id") ON DELETE SET NULL,
  "key_id"                 TEXT NOT NULL,
  "name"                   TEXT NOT NULL,
  "roles"                  TEXT NOT NULL DEFAULT '[]',
  "issuer_id_encrypted"    TEXT NOT NULL,
  "issuer_id_key_version"  INTEGER NOT NULL,
  "r2_key"                 TEXT NOT NULL,
  "encrypted_dek"          TEXT NOT NULL,
  "dek_key_version"        INTEGER NOT NULL,
  "created_at"             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX "idx_asc_keys_org_keyid" ON "asc_api_keys"("organization_id", "key_id");
CREATE INDEX "idx_asc_keys_team" ON "asc_api_keys"("apple_team_id");
CREATE INDEX "idx_asc_keys_org" ON "asc_api_keys"("organization_id");
