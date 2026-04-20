-- Drop-and-replace: legacy credential tables are superseded by the discrete
-- typed tables in 0016-0026. Dev-only migration — there is no backfill; any
-- deployed environment with non-empty `credentials` / `apple_developer_credentials`
-- will lose those rows. Orphan R2 blobs under the old credential prefixes must be
-- cleaned up out-of-band (see release notes).
DROP TABLE IF EXISTS "apple_developer_credentials";
DROP TABLE IF EXISTS "credentials";
