CREATE TABLE "android_upload_keystores" (
  "id"                            TEXT PRIMARY KEY,
  "organization_id"               TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "key_alias"                     TEXT NOT NULL,
  "encrypted_keystore_password"   TEXT NOT NULL,
  "keystore_password_key_version" INTEGER NOT NULL,
  "encrypted_key_password"        TEXT NOT NULL,
  "key_password_key_version"      INTEGER NOT NULL,
  "r2_key"                        TEXT NOT NULL,
  "encrypted_dek"                 TEXT NOT NULL,
  "dek_key_version"               INTEGER NOT NULL,
  "md5_fingerprint"               TEXT,
  "sha1_fingerprint"              TEXT,
  "sha256_fingerprint"            TEXT,
  "created_at"                    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"                    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX "idx_android_keystores_org" ON "android_upload_keystores"("organization_id");
