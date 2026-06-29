-- WebAuthn / passkey support for the web env-vault step-up gate (spec
-- docs/specs/build/11-two-vault-split-and-web-env-crud.md §P4). Purely additive
-- (prod has real users): two NEW tables, no drops, no live-table rebuild. Both
-- stay empty — and the passkey better-auth plugin stays unregistered — until the
-- WEBAUTHN_RP_ID binding is set (one-shot enable, after the vault.<host> origin +
-- a real-device passkey test). With the flag off this migration changes nothing.

-- Better Auth's `passkey` plugin table. Columns are the plugin's default fields
-- (name/publicKey/userId/credentialID/counter/deviceType/backedUp/transports/
-- createdAt/aaguid) mapped to snake_case here and bound back via the plugin's
-- `schema` config in auth.ts (same pattern as the organization/admin/apiKey
-- plugins). booleans → INTEGER, dates → TEXT, matching the existing auth tables.
CREATE TABLE "passkey" (
    "id"            TEXT PRIMARY KEY,
    "name"          TEXT,
    "public_key"    TEXT NOT NULL,
    "user_id"       TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    "credential_id" TEXT NOT NULL,
    "counter"       INTEGER NOT NULL,
    "device_type"   TEXT NOT NULL,
    "backed_up"     INTEGER NOT NULL,
    "transports"    TEXT,
    "created_at"    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    "aaguid"        TEXT
);

CREATE INDEX "idx_passkey_user" ON "passkey" ("user_id");
CREATE INDEX "idx_passkey_credential" ON "passkey" ("credential_id");

-- WebAuthn step-up record: proof that a specific browser session re-asserted a
-- passkey at `verified_at`. Keyed by the better-auth session id so a step-up in
-- one session never silently authorizes another. The web env-vault gate
-- (assert-web-env-step-up.ts) requires a row here younger than the step-up TTL
-- for any cookie-transport env mutation / escrow download; CLI (bearer/api-key)
-- callers are exempt. ON DELETE CASCADE off `user` cleans rows when an account is
-- removed; stale rows for expired sessions are harmless (the gate checks
-- freshness) and swept opportunistically on the next step-up upsert.
CREATE TABLE "passkey_step_up" (
    "session_id"  TEXT PRIMARY KEY,
    "user_id"     TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    "verified_at" TEXT NOT NULL
);

CREATE INDEX "idx_passkey_step_up_user" ON "passkey_step_up" ("user_id");
