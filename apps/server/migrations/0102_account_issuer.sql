-- Better Auth 1.7 identifies an external account by the pair ("issuer",
-- "account_id") instead of "account_id" alone, and every account row must carry
-- an issuer. The issuer names the identity source: providers without an issuer
-- of their own get a synthetic one -- "local:credential" for email/password and
-- "local:oauth:<providerId>" for OAuth (createLocalAccountIssuer /
-- createOAuthAccountIssuer in @better-auth/core). Only github and google are
-- ever configured here, and neither declares its own issuer, so the OAuth rows
-- map straight off "provider_id". No provider id used here needs the
-- percent-encoding the helper applies.
--
-- Credential rows additionally re-key "account_id" onto the linked user's id,
-- which is what better-auth has always written for that provider -- the copy is
-- a no-op for rows created by any version we have shipped, and repairs any row
-- that predates it.
--
-- SQLite cannot add a NOT NULL column without a default, so rebuild the table
-- with the create-copy-drop-rename shape used by 0100. Nothing references
-- "account" with a foreign key, so the drop fires no cascade.
--
-- The unique index is the constraint that makes the new key meaningful. If a
-- database somehow holds two rows for one (issuer, account_id) the migration
-- fails here rather than letting better-auth resolve a sign-in to an arbitrary
-- one of them; reconcile the duplicates by hand and re-run.
CREATE TABLE "account_v2" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
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

INSERT INTO "account_v2"
  ("id", "account_id", "issuer", "provider_id", "user_id", "access_token", "refresh_token",
   "id_token", "access_token_expires_at", "refresh_token_expires_at", "scope", "password",
   "created_at", "updated_at")
SELECT
  "id",
  CASE WHEN "provider_id" = 'credential' THEN "user_id" ELSE "account_id" END,
  CASE
    WHEN "provider_id" = 'credential' THEN 'local:credential'
    ELSE 'local:oauth:' || "provider_id"
  END,
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

ALTER TABLE "account_v2" RENAME TO "account";

CREATE INDEX "account_user_id_idx" ON "account" ("user_id");

CREATE UNIQUE INDEX "account_issuer_account_id_idx" ON "account" ("issuer", "account_id");
