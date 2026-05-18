-- Add @expo/fingerprint hash to builds and updates. The hash identifies the
-- exact native+JS surface a binary or OTA bundle was produced against, so
-- updates only apply to builds with a matching fingerprint.

ALTER TABLE "builds" ADD COLUMN "fingerprint_hash" TEXT;
ALTER TABLE "updates" ADD COLUMN "fingerprint_hash" TEXT;

CREATE INDEX "idx_builds_fingerprint"
  ON "builds"("project_id", "fingerprint_hash") WHERE "fingerprint_hash" IS NOT NULL;
CREATE INDEX "idx_updates_fingerprint"
  ON "updates"("fingerprint_hash") WHERE "fingerprint_hash" IS NOT NULL;
