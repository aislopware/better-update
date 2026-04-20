CREATE TABLE "apple_distribution_certificates" (
  "id"                        TEXT PRIMARY KEY,
  "organization_id"           TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "apple_team_id"             TEXT NOT NULL REFERENCES "apple_teams"("id") ON DELETE CASCADE,
  "serial_number"             TEXT NOT NULL,
  "developer_id_identifier"   TEXT,
  "valid_from"                TEXT NOT NULL,
  "valid_until"               TEXT NOT NULL,
  "r2_key"                    TEXT NOT NULL,
  "encrypted_dek"             TEXT NOT NULL,
  "encrypted_password"        TEXT NOT NULL,
  "password_key_version"      INTEGER NOT NULL,
  "dek_key_version"           INTEGER NOT NULL,
  "created_at"                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX "idx_dist_certs_team" ON "apple_distribution_certificates"("apple_team_id");
CREATE INDEX "idx_dist_certs_org" ON "apple_distribution_certificates"("organization_id");
CREATE UNIQUE INDEX "idx_dist_certs_org_serial" ON "apple_distribution_certificates"("organization_id", "serial_number");
