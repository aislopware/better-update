ALTER TABLE "ios_bundle_configurations" ADD COLUMN "target_name" TEXT;
ALTER TABLE "ios_bundle_configurations" ADD COLUMN "parent_bundle_identifier" TEXT;

CREATE INDEX "idx_ios_bundle_cfg_parent" ON "ios_bundle_configurations"("project_id", "parent_bundle_identifier");
