CREATE TABLE "apple_provisioning_profiles" (
  "id"                                  TEXT PRIMARY KEY,
  "organization_id"                     TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "apple_team_id"                       TEXT NOT NULL REFERENCES "apple_teams"("id") ON DELETE CASCADE,
  "apple_distribution_certificate_id"   TEXT REFERENCES "apple_distribution_certificates"("id") ON DELETE SET NULL,
  "bundle_identifier"                   TEXT NOT NULL,
  "distribution_type"                   TEXT NOT NULL CHECK ("distribution_type" IN ('APP_STORE','AD_HOC','ENTERPRISE','DEVELOPMENT')),
  "developer_portal_identifier"         TEXT,
  "profile_name"                        TEXT,
  "valid_until"                         TEXT,
  "r2_key"                              TEXT NOT NULL,
  "created_at"                          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"                          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX "idx_profiles_org_team_bundle_dist" ON "apple_provisioning_profiles"("organization_id", "apple_team_id", "bundle_identifier", "distribution_type");
CREATE INDEX "idx_profiles_team" ON "apple_provisioning_profiles"("apple_team_id");
CREATE INDEX "idx_profiles_cert" ON "apple_provisioning_profiles"("apple_distribution_certificate_id");
CREATE INDEX "idx_profiles_org" ON "apple_provisioning_profiles"("organization_id");
