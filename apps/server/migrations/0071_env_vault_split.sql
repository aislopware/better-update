-- Split the single org vault into a Credentials Vault (CV) and an Env Vault (EV),
-- both unlocked by the same passphrase. See docs/specs/build/11-two-vault-split-and-web-env-crud.md.
--
-- Purely additive (no drops, no live-table rebuild — prod has real users):
--   * org_vaults gains EV's own version + rotation-pending columns + a cutover
--     sentinel. The existing vault_version / rotation_pending* columns are now CV's.
--   * account_keys (NEW) — one active per-user account keypair, escrowed under the
--     user's passphrase; the server stores the blob opaquely and can never open it.
--     This is the recipient the *browser* unwraps EV with (env CRUD on the web).
--   * org_env_vault_key_wraps (NEW) — EV's key wrapped to each recipient, mirroring
--     org_vault_key_wraps but with a polymorphic recipient so a wrap can point at
--     either a user_encryption_keys row (device/recovery/machine) or an account_keys
--     row (account). A parallel table avoids a 12-step CHECK recreate of the live,
--     populated user_encryption_keys table.
--
-- env_var_revisions is intentionally NOT altered: its wrapped_dek / vault_version
-- are re-keyed in place (CV key -> EV key) at the per-org cutover (spec §7). Until
-- an org cuts over (env_vault_cutover_at IS NULL) env stays part of CV exactly as
-- today, so this migration changes no behaviour on its own.

-- EV version + rotation-pending mirror CV's rotation_pending* (migration 0064).
-- env_vault_cutover_at is the fork sentinel: NULL = env still in CV (legacy, the
-- value for every existing org after this migration); a timestamp = env forked to
-- EV at env_vault_version. It makes "has this org forked its env vault?" an explicit
-- boolean rather than an inference over wrap rows.
ALTER TABLE "org_vaults" ADD COLUMN "env_vault_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "org_vaults" ADD COLUMN "env_rotation_pending" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "org_vaults" ADD COLUMN "env_rotation_pending_since" TEXT;
ALTER TABLE "org_vaults" ADD COLUMN "env_rotation_pending_reason" TEXT;
ALTER TABLE "org_vaults" ADD COLUMN "env_vault_cutover_at" TEXT;

-- Per-user account keypair. Cross-org like a device key (one identity, many orgs via
-- per-org EV wraps). Unlike user_encryption_keys (public recipient keys only), this
-- table also stores the passphrase-sealed escrow blob (escrow_ct + salt + kdf_params)
-- so the browser can fetch + locally unseal it. age_public_key is the EV recipient;
-- ed25519_public_key is reserved for the deferred signed-roster integrity layer (§8).
CREATE TABLE "account_keys" (
    "id"                 TEXT PRIMARY KEY,
    "user_id"            TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    "age_public_key"     TEXT NOT NULL,
    "ed25519_public_key" TEXT NOT NULL,
    "escrow_ct"          TEXT NOT NULL,
    "salt"               TEXT NOT NULL,
    "kdf_params"         TEXT NOT NULL,
    "fingerprint"        TEXT NOT NULL,
    "created_at"         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    "last_used_at"       TEXT,
    "revoked_at"         TEXT
);

CREATE UNIQUE INDEX "idx_account_keys_age_public_key"
    ON "account_keys" ("age_public_key");
-- At most one live account key per user (partial unique on the not-yet-revoked row).
CREATE UNIQUE INDEX "idx_account_keys_user_active"
    ON "account_keys" ("user_id") WHERE "revoked_at" IS NULL;
CREATE INDEX "idx_account_keys_user"
    ON "account_keys" ("user_id");

-- EV's key wrapped to each recipient. Polymorphic recipient: (recipient_kind,
-- recipient_id) references either user_encryption_keys.id (device/recovery/machine)
-- or account_keys.id (account). No hard FK on recipient_id (polymorphic) — integrity
-- is enforced in the app layer + the reconcile/revoke pass, mirroring how
-- org_vault_key_wraps is maintained.
CREATE TABLE "org_env_vault_key_wraps" (
    "organization_id"   TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
    "env_vault_version" INTEGER NOT NULL,
    "recipient_kind"    TEXT NOT NULL CHECK ("recipient_kind" IN ('device', 'recovery', 'machine', 'account')),
    "recipient_id"      TEXT NOT NULL,
    "wrapped_key"       TEXT NOT NULL,
    "created_at"        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY ("organization_id", "env_vault_version", "recipient_kind", "recipient_id")
);

CREATE INDEX "idx_org_env_vault_key_wraps_recipient"
    ON "org_env_vault_key_wraps" ("recipient_kind", "recipient_id");
CREATE INDEX "idx_org_env_vault_key_wraps_org_version"
    ON "org_env_vault_key_wraps" ("organization_id", "env_vault_version");
