-- Store the keystore container format (JKS or PKCS12) extracted client-side at
-- upload, so the dashboard can show it next to the alias (EAS parity). Existing
-- rows predate the field; backfill them to JKS — the historical default emitted
-- by `generateAndroidKeystore` and the overwhelming majority of uploads. New
-- uploads carry the true detected format.
ALTER TABLE "android_upload_keystores" ADD COLUMN "keystore_type" TEXT;

UPDATE "android_upload_keystores" SET "keystore_type" = 'JKS' WHERE "keystore_type" IS NULL;
