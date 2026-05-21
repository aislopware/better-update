-- Client-side end-to-end credential vault (see docs/specs/build/02-credential-vault.md).
-- The server stores only public recipient keys and opaque wrapped blobs; it can
-- never decrypt. Three tables:
--   user_encryption_keys  — registered recipient public keys (age1...)
--   org_vaults            — authoritative per-org vault key version (CAS guard)
--   org_vault_key_wraps   — the org vault key wrapped to each recipient (age blob)
-- A `device` key is user-owned (works across the user's orgs via per-org wraps);
-- `recovery` (offline break-glass) and `machine` (CI) keys are org-owned.

CREATE TABLE "user_encryption_keys" (
    "id"              TEXT PRIMARY KEY,
    "user_id"         TEXT REFERENCES "user" ("id") ON DELETE CASCADE,
    "organization_id" TEXT REFERENCES "organization" ("id") ON DELETE CASCADE,
    "kind"            TEXT NOT NULL CHECK ("kind" IN ('device', 'recovery', 'machine')),
    "public_key"      TEXT NOT NULL,
    "label"           TEXT NOT NULL,
    "fingerprint"     TEXT NOT NULL,
    "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    "last_used_at"    TEXT,
    "revoked_at"      TEXT,
    CHECK (
        ("kind" = 'device' AND "user_id" IS NOT NULL AND "organization_id" IS NULL) OR
        ("kind" IN ('recovery', 'machine') AND "organization_id" IS NOT NULL AND "user_id" IS NULL)
    )
);

CREATE UNIQUE INDEX "idx_user_encryption_keys_public_key"
    ON "user_encryption_keys" ("public_key");
CREATE INDEX "idx_user_encryption_keys_user"
    ON "user_encryption_keys" ("user_id") WHERE "user_id" IS NOT NULL;
CREATE INDEX "idx_user_encryption_keys_org"
    ON "user_encryption_keys" ("organization_id") WHERE "organization_id" IS NOT NULL;

CREATE TABLE "org_vaults" (
    "organization_id" TEXT PRIMARY KEY REFERENCES "organization" ("id") ON DELETE CASCADE,
    "vault_version"   INTEGER NOT NULL DEFAULT 1,
    "created_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    "updated_at"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE "org_vault_key_wraps" (
    "organization_id"        TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
    "vault_version"          INTEGER NOT NULL,
    "user_encryption_key_id" TEXT NOT NULL REFERENCES "user_encryption_keys" ("id") ON DELETE CASCADE,
    "wrapped_key"            TEXT NOT NULL,
    "created_at"             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY ("organization_id", "vault_version", "user_encryption_key_id")
);

CREATE INDEX "idx_org_vault_key_wraps_recipient"
    ON "org_vault_key_wraps" ("user_encryption_key_id");
CREATE INDEX "idx_org_vault_key_wraps_org_version"
    ON "org_vault_key_wraps" ("organization_id", "vault_version");
