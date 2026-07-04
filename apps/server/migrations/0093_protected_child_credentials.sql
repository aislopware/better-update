-- Per-credential protected toggles (GITLAB-RBAC-SPEC §3b). Protection of an
-- EXISTING credential now reads the row's own flag only; the team flag gates
-- team-level interactions (creating credentials under the team, devices).
-- New child rows snapshot the team flag at creation time.
ALTER TABLE "apple_distribution_certificates" ADD COLUMN "is_protected" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "apple_push_keys" ADD COLUMN "is_protected" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "apple_push_certificates" ADD COLUMN "is_protected" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "apple_pay_certificates" ADD COLUMN "is_protected" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "apple_pass_type_certificates" ADD COLUMN "is_protected" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "apple_provisioning_profiles" ADD COLUMN "is_protected" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "asc_api_keys" ADD COLUMN "is_protected" INTEGER NOT NULL DEFAULT 0;

-- Backfill EVERY existing credential row protected — teams and the
-- pre-existing per-row flags included (owner decision 2026-07-04): the
-- fleet starts locked down and admins unprotect selectively. This also
-- covers the two rows that must not lose protection — children of
-- already-protected teams (old cascade) and team-less ASC keys (old
-- always-protected convention, spec §2a-3).
UPDATE "apple_teams" SET "is_protected" = 1;
UPDATE "apple_distribution_certificates" SET "is_protected" = 1;
UPDATE "apple_push_keys" SET "is_protected" = 1;
UPDATE "apple_push_certificates" SET "is_protected" = 1;
UPDATE "apple_pay_certificates" SET "is_protected" = 1;
UPDATE "apple_pass_type_certificates" SET "is_protected" = 1;
UPDATE "apple_provisioning_profiles" SET "is_protected" = 1;
UPDATE "asc_api_keys" SET "is_protected" = 1;
UPDATE "google_service_account_keys" SET "is_protected" = 1;
UPDATE "android_upload_keystores" SET "is_protected" = 1;
