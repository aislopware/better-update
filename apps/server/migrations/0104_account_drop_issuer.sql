-- Better Auth 1.7.3 reverted the 1.7.0 account identity change: an external
-- account is once again keyed on ("provider_id", "account_id") and no "issuer"
-- is ever written. Migration 0102 rebuilt "account" with "issuer" NOT NULL and
-- a UNIQUE index on ("issuer", "account_id"); left in place, every insert into
-- "account" (sign-up, OAuth account linking) fails the NOT NULL constraint,
-- and 1.7.3's default schema validation reports the column as "required but
-- Better Auth never writes it". `auth migrate` does not perform this cleanup.
--
-- SQLite cannot drop a NOT NULL column that an index references without a
-- rebuild, so use the create-copy-drop-rename shape of 0100 / 0102. The
-- credential rows keep the "account_id" = "user_id" re-key 0102 applied — that
-- is what better-auth writes for that provider under either identity scheme.
--
-- The UNIQUE index on ("provider_id", "account_id") restores the constraint
-- 0102 enforced through the issuer: the issuer was derived from "provider_id"
-- for every provider configured here ('local:credential' / 'local:oauth:<id>'),
-- so the two keys are equivalent over the rows this database can hold. If two
-- rows somehow share a (provider_id, account_id) pair the migration fails here
-- rather than letting better-auth resolve a sign-in to an arbitrary one of
-- them; reconcile by hand and re-run.
CREATE TABLE "account_v3" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "access_token" TEXT,
  "refresh_token" TEXT,
  "id_token" TEXT,
  "access_token_expires_at" DATE,
  "refresh_token_expires_at" DATE,
  "scope" TEXT,
  "password" TEXT,
  "created_at" DATE NOT NULL,
  "updated_at" DATE NOT NULL
);

INSERT INTO "account_v3"
  ("id", "account_id", "provider_id", "user_id", "access_token", "refresh_token",
   "id_token", "access_token_expires_at", "refresh_token_expires_at", "scope", "password",
   "created_at", "updated_at")
SELECT
  "id",
  "account_id",
  "provider_id",
  "user_id",
  "access_token",
  "refresh_token",
  "id_token",
  "access_token_expires_at",
  "refresh_token_expires_at",
  "scope",
  "password",
  "created_at",
  "updated_at"
FROM "account";

DROP TABLE "account";

ALTER TABLE "account_v3" RENAME TO "account";

CREATE INDEX "account_user_id_idx" ON "account" ("user_id");

CREATE UNIQUE INDEX "account_provider_id_account_id_idx" ON "account" ("provider_id", "account_id");
