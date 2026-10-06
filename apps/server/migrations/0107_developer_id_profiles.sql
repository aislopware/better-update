-- Developer ID provisioning profiles (App Store Connect `MAC_APP_DIRECT`): a
-- macOS app distributed outside the Mac App Store embeds one when it claims an
-- entitlement Apple must authorize (iCloud, push, associated domains, keychain
-- sharing, …). Widen the "distribution_type" CHECK with 'DEVELOPER_ID'. SQLite
-- cannot alter a CHECK, so the table is rebuilt.
--
-- Its one FK child, ios_bundle_configurations, references it ON DELETE SET
-- NULL. DROP TABLE runs an implicit DELETE that fires that action while
-- foreign keys are enforced (always, on D1), so every bundle configuration
-- would lose its profile. The links are stashed first and restored after the
-- swap; the child's FK clause names the table textually, so once the rebuilt
-- table takes the name it points at it.
--
-- Additive for clients: only a Developer ID-capable CLI uploads such profiles.

-- 1. Stash the links the drop would null out.
CREATE TABLE "_stash_bundle_cfg_profiles" AS
  SELECT "id", "apple_provisioning_profile_id" FROM "ios_bundle_configurations"
  WHERE "apple_provisioning_profile_id" IS NOT NULL;

-- 2. Rebuild with the widened CHECK (column order matches the existing table,
--    including the columns migrations 0027 and 0093 appended).
CREATE TABLE "apple_provisioning_profiles_v2" (
  "id"                                  TEXT PRIMARY KEY,
  "organization_id"                     TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "apple_team_id"                       TEXT NOT NULL REFERENCES "apple_teams"("id") ON DELETE CASCADE,
  "apple_distribution_certificate_id"   TEXT REFERENCES "apple_distribution_certificates"("id") ON DELETE SET NULL,
  "bundle_identifier"                   TEXT NOT NULL,
  "distribution_type"                   TEXT NOT NULL CHECK ("distribution_type" IN (
    'APP_STORE', 'AD_HOC', 'ENTERPRISE', 'DEVELOPMENT', 'DEVELOPER_ID'
  )),
  "developer_portal_identifier"         TEXT,
  "profile_name"                        TEXT,
  "valid_until"                         TEXT,
  "r2_key"                              TEXT NOT NULL,
  "created_at"                          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"                          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "is_managed"                          INTEGER NOT NULL DEFAULT 0,
  "device_roster_hash"                  TEXT,
  "is_protected"                        INTEGER NOT NULL DEFAULT 0
);

INSERT INTO "apple_provisioning_profiles_v2"
  SELECT "id", "organization_id", "apple_team_id", "apple_distribution_certificate_id",
         "bundle_identifier", "distribution_type", "developer_portal_identifier",
         "profile_name", "valid_until", "r2_key", "created_at", "updated_at",
         "is_managed", "device_roster_hash", "is_protected"
  FROM "apple_provisioning_profiles";

DROP TABLE "apple_provisioning_profiles";
ALTER TABLE "apple_provisioning_profiles_v2" RENAME TO "apple_provisioning_profiles";

CREATE UNIQUE INDEX "idx_profiles_org_team_bundle_dist" ON "apple_provisioning_profiles"("organization_id", "apple_team_id", "bundle_identifier", "distribution_type");
CREATE INDEX "idx_profiles_team" ON "apple_provisioning_profiles"("apple_team_id");
CREATE INDEX "idx_profiles_cert" ON "apple_provisioning_profiles"("apple_distribution_certificate_id");
CREATE INDEX "idx_profiles_org" ON "apple_provisioning_profiles"("organization_id");

-- 3. Restore the links.
UPDATE "ios_bundle_configurations" SET "apple_provisioning_profile_id" = (
  SELECT "apple_provisioning_profile_id" FROM "_stash_bundle_cfg_profiles" AS "s"
  WHERE "s"."id" = "ios_bundle_configurations"."id"
)
WHERE "id" IN (SELECT "id" FROM "_stash_bundle_cfg_profiles");

DROP TABLE "_stash_bundle_cfg_profiles";
