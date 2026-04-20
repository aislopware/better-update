CREATE TABLE "android_build_credentials" (
  "id"                                               TEXT PRIMARY KEY,
  "organization_id"                                  TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "android_application_identifier_id"                TEXT NOT NULL REFERENCES "android_application_identifiers"("id") ON DELETE CASCADE,
  "android_upload_keystore_id"                       TEXT REFERENCES "android_upload_keystores"("id") ON DELETE SET NULL,
  "google_service_account_key_for_submissions_id"    TEXT REFERENCES "google_service_account_keys"("id") ON DELETE SET NULL,
  "google_service_account_key_for_fcm_v1_id"         TEXT REFERENCES "google_service_account_keys"("id") ON DELETE SET NULL,
  "name"                                             TEXT NOT NULL,
  "is_default"                                       INTEGER NOT NULL DEFAULT 0,
  "created_at"                                       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"                                       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX "idx_android_build_creds_default" ON "android_build_credentials"("android_application_identifier_id") WHERE "is_default" = 1;
CREATE INDEX "idx_android_build_creds_app_id" ON "android_build_credentials"("android_application_identifier_id");
CREATE INDEX "idx_android_build_creds_org" ON "android_build_credentials"("organization_id");
