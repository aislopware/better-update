-- Client-side end-to-end credentials (see docs/specs/build/02-credential-vault.md).
-- Secret credentials move from server-side envelope encryption (the Vault, keyed by
-- VAULT_KEYRING) to true client-side E2E: the server stores opaque client-produced
-- ciphertext in R2 plus a per-credential "wrapped_dek" (the DEK wrapped under the org
-- vault key, age blob) and the "vault_version" it was wrapped at. The server NEVER
-- decrypts.
--
-- This drops the old server-side encryption columns (encrypted_dek / dek_key_version,
-- plus the per-secret password columns) and adds wrapped_dek + vault_version. Prod has
-- NO real users, so this is a clean break: every credential row is deleted first
-- (mirroring 0038_env_vars_drop_encryption.sql). Orphaned R2 objects are acceptable —
-- they are encrypted blobs the server can no longer reference. Adding NOT NULL columns
-- without a default is valid here because each table is emptied first.

-- Apple distribution certificates --------------------------------------------
DELETE FROM "apple_distribution_certificates";
ALTER TABLE "apple_distribution_certificates" DROP COLUMN "encrypted_dek";
ALTER TABLE "apple_distribution_certificates" DROP COLUMN "encrypted_password";
ALTER TABLE "apple_distribution_certificates" DROP COLUMN "password_key_version";
ALTER TABLE "apple_distribution_certificates" DROP COLUMN "dek_key_version";
ALTER TABLE "apple_distribution_certificates" ADD COLUMN "wrapped_dek" TEXT NOT NULL;
ALTER TABLE "apple_distribution_certificates" ADD COLUMN "vault_version" INTEGER NOT NULL;

-- Apple push keys ------------------------------------------------------------
DELETE FROM "apple_push_keys";
ALTER TABLE "apple_push_keys" DROP COLUMN "encrypted_dek";
ALTER TABLE "apple_push_keys" DROP COLUMN "dek_key_version";
ALTER TABLE "apple_push_keys" ADD COLUMN "wrapped_dek" TEXT NOT NULL;
ALTER TABLE "apple_push_keys" ADD COLUMN "vault_version" INTEGER NOT NULL;

-- App Store Connect API keys -------------------------------------------------
DELETE FROM "asc_api_keys";
ALTER TABLE "asc_api_keys" DROP COLUMN "encrypted_dek";
ALTER TABLE "asc_api_keys" DROP COLUMN "dek_key_version";
ALTER TABLE "asc_api_keys" ADD COLUMN "wrapped_dek" TEXT NOT NULL;
ALTER TABLE "asc_api_keys" ADD COLUMN "vault_version" INTEGER NOT NULL;

-- Google service account keys ------------------------------------------------
DELETE FROM "google_service_account_keys";
ALTER TABLE "google_service_account_keys" DROP COLUMN "encrypted_dek";
ALTER TABLE "google_service_account_keys" DROP COLUMN "dek_key_version";
ALTER TABLE "google_service_account_keys" ADD COLUMN "wrapped_dek" TEXT NOT NULL;
ALTER TABLE "google_service_account_keys" ADD COLUMN "vault_version" INTEGER NOT NULL;

-- Android upload keystores ---------------------------------------------------
DELETE FROM "android_upload_keystores";
ALTER TABLE "android_upload_keystores" DROP COLUMN "encrypted_keystore_password";
ALTER TABLE "android_upload_keystores" DROP COLUMN "keystore_password_key_version";
ALTER TABLE "android_upload_keystores" DROP COLUMN "encrypted_key_password";
ALTER TABLE "android_upload_keystores" DROP COLUMN "key_password_key_version";
ALTER TABLE "android_upload_keystores" DROP COLUMN "encrypted_dek";
ALTER TABLE "android_upload_keystores" DROP COLUMN "dek_key_version";
ALTER TABLE "android_upload_keystores" ADD COLUMN "wrapped_dek" TEXT NOT NULL;
ALTER TABLE "android_upload_keystores" ADD COLUMN "vault_version" INTEGER NOT NULL;
