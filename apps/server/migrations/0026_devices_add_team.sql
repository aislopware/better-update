ALTER TABLE "devices" ADD COLUMN "apple_team_id" TEXT REFERENCES "apple_teams"("id") ON DELETE SET NULL;

DROP INDEX "idx_devices_org_identifier";
CREATE UNIQUE INDEX "idx_devices_org_team_identifier"
  ON "devices"("organization_id", COALESCE("apple_team_id", ''), "identifier");
CREATE INDEX "idx_devices_team" ON "devices"("apple_team_id");

ALTER TABLE "device_registration_requests" ADD COLUMN "apple_team_id" TEXT REFERENCES "apple_teams"("id") ON DELETE SET NULL;
CREATE INDEX "idx_drr_team" ON "device_registration_requests"("apple_team_id");
