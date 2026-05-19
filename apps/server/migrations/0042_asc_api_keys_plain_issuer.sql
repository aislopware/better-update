-- App Store Connect issuer IDs are non-secret UUIDs surfaced openly in the dashboard
-- (matching EAS UX). Drop the per-row encryption columns and store the value plainly.

ALTER TABLE "asc_api_keys" DROP COLUMN "issuer_id_encrypted";
ALTER TABLE "asc_api_keys" DROP COLUMN "issuer_id_key_version";
ALTER TABLE "asc_api_keys" ADD COLUMN "issuer_id" TEXT NOT NULL DEFAULT '';
