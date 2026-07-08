-- Legacy robots die for good (owner decision 2026-07-08). 0092 kept pre-v2
-- rows (NULL project) listed as "legacy — recreate", and 0077 backfills could
-- leave bearer-less vault-only rows; both are DELETED here — nothing legacy
-- stays listed — and the table is rebuilt so project, role, and bearer are
-- NOT NULL invariants going forward. Prod holds no such rows; this is
-- enforcement, not data surgery.

-- Env-vault wraps carry no FK (polymorphic recipient) — clear a legacy
-- robot's machine-key wraps explicitly before its key rows go.
DELETE FROM "org_env_vault_key_wraps"
WHERE "recipient_kind" = 'machine'
  AND "recipient_id" IN (
    SELECT "user_encryption_key_id" FROM "robot_account"
    WHERE ("project_id" IS NULL OR "bearer_key_hash" IS NULL)
      AND "user_encryption_key_id" IS NOT NULL
  );

-- Credential-vault wraps cascade off user_encryption_keys (0046 FK).
DELETE FROM "user_encryption_keys"
WHERE "id" IN (
  SELECT "user_encryption_key_id" FROM "robot_account"
  WHERE ("project_id" IS NULL OR "bearer_key_hash" IS NULL)
    AND "user_encryption_key_id" IS NOT NULL
);

DELETE FROM "robot_account"
WHERE "project_id" IS NULL OR "bearer_key_hash" IS NULL;

-- Table recreate (SQLite can't add NOT NULL in place): identical shape minus
-- the legacy nullability + its project/role CHECK pairing.
CREATE TABLE "robot_account_v3" (
  "id"                     TEXT NOT NULL PRIMARY KEY,
  "organization_id"        TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "project_id"             TEXT NOT NULL REFERENCES "projects" ("id") ON DELETE CASCADE,
  "project_role"           TEXT NOT NULL CHECK ("project_role" IN ('maintainer', 'developer', 'reporter')),
  "name"                   TEXT NOT NULL,
  "bearer_key_hash"        TEXT NOT NULL,
  "bearer_start"           TEXT NOT NULL,
  "user_encryption_key_id" TEXT REFERENCES "user_encryption_keys" ("id") ON DELETE SET NULL,
  "created_at"             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "revoked_at"             TEXT
);

INSERT INTO "robot_account_v3"
  ("id", "organization_id", "project_id", "project_role", "name",
   "bearer_key_hash", "bearer_start", "user_encryption_key_id", "created_at", "revoked_at")
SELECT
  "id", "organization_id", "project_id", "project_role", "name",
  "bearer_key_hash", "bearer_start", "user_encryption_key_id", "created_at", "revoked_at"
FROM "robot_account";

DROP TABLE "robot_account";
ALTER TABLE "robot_account_v3" RENAME TO "robot_account";

CREATE UNIQUE INDEX "idx_robot_account_bearer_hash"
  ON "robot_account" ("bearer_key_hash");
CREATE INDEX "idx_robot_account_org" ON "robot_account" ("organization_id");
CREATE INDEX "idx_robot_account_project" ON "robot_account" ("project_id");
CREATE UNIQUE INDEX "idx_robot_account_user_encryption_key"
  ON "robot_account" ("user_encryption_key_id") WHERE "user_encryption_key_id" IS NOT NULL;
