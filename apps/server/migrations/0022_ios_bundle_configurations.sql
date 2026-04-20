CREATE TABLE "ios_bundle_configurations" (
  "id"                                  TEXT PRIMARY KEY,
  "organization_id"                     TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "project_id"                          TEXT NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "bundle_identifier"                   TEXT NOT NULL,
  "distribution_type"                   TEXT NOT NULL CHECK ("distribution_type" IN ('APP_STORE','AD_HOC','ENTERPRISE','DEVELOPMENT')),
  "apple_team_id"                       TEXT NOT NULL REFERENCES "apple_teams"("id") ON DELETE RESTRICT,
  "apple_distribution_certificate_id"   TEXT REFERENCES "apple_distribution_certificates"("id") ON DELETE SET NULL,
  "apple_provisioning_profile_id"       TEXT REFERENCES "apple_provisioning_profiles"("id") ON DELETE SET NULL,
  "apple_push_key_id"                   TEXT REFERENCES "apple_push_keys"("id") ON DELETE SET NULL,
  "asc_api_key_id"                      TEXT REFERENCES "asc_api_keys"("id") ON DELETE SET NULL,
  "created_at"                          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"                          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX "idx_ios_bundle_cfg_unique" ON "ios_bundle_configurations"("project_id", "bundle_identifier", "distribution_type");
CREATE INDEX "idx_ios_bundle_cfg_org" ON "ios_bundle_configurations"("organization_id");
CREATE INDEX "idx_ios_bundle_cfg_project" ON "ios_bundle_configurations"("project_id");
CREATE INDEX "idx_ios_bundle_cfg_team" ON "ios_bundle_configurations"("apple_team_id");
