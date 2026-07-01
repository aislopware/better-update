-- API key feature deleted outright: superseded by robot_account (0077), and
-- was unused in prod, so no data migration is needed — bu_-prefixed bearer
-- secrets simply stop authenticating.
DROP INDEX IF EXISTS "apikey_key_idx";
DROP INDEX IF EXISTS "apikey_reference_id_idx";
DROP INDEX IF EXISTS "apikey_config_id_idx";
DROP TABLE "apikey";
