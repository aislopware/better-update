CREATE TABLE "apple_pass_type_certificates" (
  "id"                   TEXT PRIMARY KEY,
  "organization_id"      TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "apple_team_id"        TEXT NOT NULL REFERENCES "apple_teams"("id") ON DELETE CASCADE,
  "pass_type_identifier" TEXT NOT NULL,
  "serial_number"        TEXT NOT NULL,
  "valid_from"           TEXT NOT NULL,
  "valid_until"          TEXT NOT NULL,
  "r2_key"               TEXT NOT NULL,
  "wrapped_dek"          TEXT NOT NULL,
  "vault_version"        INTEGER NOT NULL,
  "created_at"           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX "idx_pass_type_certificates_org_serial" ON "apple_pass_type_certificates"("organization_id", "serial_number");
CREATE INDEX "idx_pass_type_certificates_pass_type" ON "apple_pass_type_certificates"("organization_id", "pass_type_identifier");
CREATE INDEX "idx_pass_type_certificates_team" ON "apple_pass_type_certificates"("apple_team_id");
CREATE INDEX "idx_pass_type_certificates_org" ON "apple_pass_type_certificates"("organization_id");
