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
-- 0102 enforced through the issuer. The two keys are NOT equivalent over the
-- rows a database that ran 1.7.1 / 1.7.2 holds: 0102 backfilled OAuth rows
-- with 'local:oauth:<provider>', but those releases looked accounts up by the
-- provider's real issuer (e.g. 'https://accounts.google.com'), missed the
-- backfilled row and inserted a second one for the same user on the next
-- sign-in. Such pairs share "user_id", so the copy keeps only the most
-- recently updated row per ("provider_id", "account_id", "user_id") — the one
-- carrying the freshest tokens. Rows sharing a (provider_id, account_id) pair
-- across DIFFERENT users are all kept, so the index creation fails here rather
-- than letting better-auth resolve a sign-in to an arbitrary one of them;
-- reconcile by hand and re-run.
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
FROM "account" AS "a"
WHERE "a"."id" = (
  SELECT "b"."id"
  FROM "account" AS "b"
  WHERE "b"."provider_id" = "a"."provider_id"
    AND "b"."account_id" = "a"."account_id"
    AND "b"."user_id" = "a"."user_id"
  ORDER BY "b"."updated_at" DESC, "b"."created_at" DESC, "b"."id" DESC
  LIMIT 1
);

DROP TABLE "account";

ALTER TABLE "account_v3" RENAME TO "account";

CREATE INDEX "account_user_id_idx" ON "account" ("user_id");

CREATE UNIQUE INDEX "account_provider_id_account_id_idx" ON "account" ("provider_id", "account_id");
