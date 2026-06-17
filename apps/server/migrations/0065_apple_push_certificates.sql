CREATE TABLE "apple_push_certificates" (
  "id"                TEXT PRIMARY KEY,
  "organization_id"   TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "apple_team_id"     TEXT NOT NULL REFERENCES "apple_teams"("id") ON DELETE CASCADE,
  "bundle_identifier" TEXT NOT NULL,
  "serial_number"     TEXT NOT NULL,
  "valid_from"        TEXT NOT NULL,
  "valid_until"       TEXT NOT NULL,
  "r2_key"            TEXT NOT NULL,
  "wrapped_dek"       TEXT NOT NULL,
  "vault_version"     INTEGER NOT NULL,
  "created_at"        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX "idx_push_certificates_org_serial" ON "apple_push_certificates"("organization_id", "serial_number");
CREATE INDEX "idx_push_certificates_bundle" ON "apple_push_certificates"("organization_id", "bundle_identifier");
CREATE INDEX "idx_push_certificates_team" ON "apple_push_certificates"("apple_team_id");
CREATE INDEX "idx_push_certificates_org" ON "apple_push_certificates"("organization_id");
