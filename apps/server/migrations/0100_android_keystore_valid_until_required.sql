-- Make "valid_until" mandatory. 0099 added it nullable because the server never
-- sees keystore bytes, so only a CLI new enough to run keytool can supply the
-- date, and every row predating that CLI had to stay readable. Those rows have
-- since been re-uploaded, the version killswitch (REQUIRE_CLI_VERSION_ABOVE)
-- already refuses every CLI below 0.72.0, and the upload body now requires the
-- field -- so a null can no longer be written and "unknown expiry" stops being a
-- state the dashboard has to render.
--
-- SQLite cannot tighten a column in place, so rebuild the table with the
-- create-copy-drop-rename shape used by 0092_robot_project_scope.sql. Unlike the
-- earlier rebuilds this table has a child: android_build_credentials points at
-- it with ON DELETE SET NULL, and DROP TABLE runs an implicit DELETE that fires
-- that action whenever foreign keys are enforced. Stash the links first and put
-- them back after the rename, which is a no-op if the drop left them alone.
--
-- A self-hosted database still holding pre-0.72 rows fails the copy on the NOT
-- NULL constraint. That is deliberate: re-upload those keystores with a current
-- CLI. Deleting them or inventing a date would strand the R2 envelope or make
-- the dashboard lie about when a build stops being signable.
CREATE TABLE "android_build_credential_keystore_link" (
  "id"                         TEXT PRIMARY KEY,
  "android_upload_keystore_id" TEXT NOT NULL
);

INSERT INTO "android_build_credential_keystore_link" ("id", "android_upload_keystore_id")
SELECT "id", "android_upload_keystore_id"
FROM "android_build_credentials"
WHERE "android_upload_keystore_id" IS NOT NULL;

CREATE TABLE "android_upload_keystores_v2" (
  "id"                TEXT PRIMARY KEY,
  "organization_id"   TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name"              TEXT,
  "key_alias"         TEXT NOT NULL,
  "r2_key"            TEXT NOT NULL,
  "wrapped_dek"       TEXT NOT NULL,
  "vault_version"     INTEGER NOT NULL,
  "keystore_type"     TEXT,
  "md5_fingerprint"   TEXT,
  "sha1_fingerprint"  TEXT,
  "sha256_fingerprint" TEXT,
  "valid_until"       TEXT NOT NULL,
  "is_protected"      INTEGER NOT NULL DEFAULT 0,
  "created_at"        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at"        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO "android_upload_keystores_v2"
  ("id", "organization_id", "name", "key_alias", "r2_key", "wrapped_dek", "vault_version",
   "keystore_type", "md5_fingerprint", "sha1_fingerprint", "sha256_fingerprint", "valid_until",
   "is_protected", "created_at", "updated_at")
SELECT
  "id", "organization_id", "name", "key_alias", "r2_key", "wrapped_dek", "vault_version",
  "keystore_type", "md5_fingerprint", "sha1_fingerprint", "sha256_fingerprint", "valid_until",
  "is_protected", "created_at", "updated_at"
FROM "android_upload_keystores";

DROP TABLE "android_upload_keystores";

ALTER TABLE "android_upload_keystores_v2" RENAME TO "android_upload_keystores";

CREATE INDEX "idx_android_keystores_org" ON "android_upload_keystores"("organization_id");

UPDATE "android_build_credentials"
SET "android_upload_keystore_id" = (
  SELECT "link"."android_upload_keystore_id"
  FROM "android_build_credential_keystore_link" AS "link"
  WHERE "link"."id" = "android_build_credentials"."id"
)
WHERE "id" IN (SELECT "id" FROM "android_build_credential_keystore_link");

DROP TABLE "android_build_credential_keystore_link";
