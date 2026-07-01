-- Unifies the CI-facing "api key" (bearer auth) and "machine" vault identity
-- into one org-owned robot_account row (see docs/specs, robot-account plan).
-- robot_account does NOT replace user_encryption_keys — it references the
-- existing 'machine'-kind row for vault access, so device/recovery rows and
-- vault rotation are completely untouched.
CREATE TABLE "robot_account" (
    "id"                     TEXT NOT NULL PRIMARY KEY,
    "organization_id"        TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
    "name"                   TEXT NOT NULL,
    -- Bearer half (HTTP API auth), hashed the same way apikey.key was (SHA-256
    -- -> unpadded base64url via CryptoService). NULL until minted/re-minted.
    "bearer_key_hash"        TEXT,
    "bearer_start"           TEXT,
    -- Vault-decrypt half: FK to the machine-kind recipient row. NULL if this
    -- robot has never been granted vault access.
    "user_encryption_key_id" TEXT REFERENCES "user_encryption_keys" ("id") ON DELETE SET NULL,
    "created_at"             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    "revoked_at"             TEXT
);

CREATE UNIQUE INDEX "idx_robot_account_bearer_hash"
    ON "robot_account" ("bearer_key_hash") WHERE "bearer_key_hash" IS NOT NULL;
CREATE INDEX "idx_robot_account_org" ON "robot_account" ("organization_id");
CREATE UNIQUE INDEX "idx_robot_account_user_encryption_key"
    ON "robot_account" ("user_encryption_key_id") WHERE "user_encryption_key_id" IS NOT NULL;

-- Backfill: every existing org-owned `machine` recipient becomes a vault-only
-- robot account (no bearer secret yet). Reuse the same id 1:1 so
-- user_encryption_key_id is trivially derivable and the private key relation
-- needs no new id generation in raw SQL. These robots keep decrypting the
-- vault exactly as before; run `credentials robot rotate <id>` once to mint a
-- bearer secret for API auth too.
INSERT INTO "robot_account"
    ("id", "organization_id", "name", "bearer_key_hash", "bearer_start",
     "user_encryption_key_id", "created_at", "revoked_at")
SELECT "id", "organization_id", "label", NULL, NULL,
       "id", "created_at", "revoked_at"
FROM "user_encryption_keys"
WHERE "kind" = 'machine';
