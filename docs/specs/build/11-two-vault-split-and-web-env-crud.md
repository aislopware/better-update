# 11. Two-Vault Split & Web Env CRUD

> **Status:** P0–P3 implemented + adversarially reviewed (all green); P4 (web + 2FA + origin) and
> P5 (per-org cutover rollout) pending. Supersedes the
> never-committed `11-passbolt-web-vault-and-2fa.md` sketch (memory
> `project_web_vault_mutations_design.md`): that draft kept **one** shared key and bolted on a
> server-escrowed account key. The goal below ("CRUD env from the browser") **forces a true
> key split** — any key the browser can obtain must NOT also open signing credentials.
>
> Companion to [02-credential-vault.md](./02-credential-vault.md) (the E2E credential vault),
> [03-environment-variables.md](./03-environment-variables.md) (E2E env vars), and
> [10-vault-lifecycle-revocation.md](./10-vault-lifecycle-revocation.md) (recipient lifecycle).
> This doc splits the single org vault into two and gives the browser a scoped key to the env
> half.

## 0. Goals & approved decisions

1. **Split** the single org vault into a **Credentials Vault (CV)** and an **Env Vault (EV)**.
2. **One passphrase** unlocks both (CLI) and the env half (web).
3. **Env values are CRUD-able from the web** while remaining **E2E-encrypted**.

Approved choices (asked & answered 2026-06-28):

| Decision           | Choice                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------- |
| Env posture on web | **Keep E2E** via a per-user account key (browser does the crypto).                      |
| Web feature scope  | **Env value CRUD only.** All lifecycle (grant/revoke/rotate/recipient mgmt) stays CLI.  |
| Rollout            | **One-shot cutover** per org (no dual-wrap). Old CLIs lose **env** read until upgraded. |
| 2FA                | **Mandatory** step-up before the web serves the account escrow / allows env access.     |
| Web origin         | **Independent origin** `vault.<host>` with strict CSP/SRI (default; see §8 caveat).     |

**The one load-bearing invariant:** `EV key ≠ CV key`, and **CV is never wrapped to an
account / browser-reachable recipient.** Violating this single line silently hands signing
credentials to the browser. Everything else degrades gracefully.

## 1. Current architecture (single shared vault) — what we are splitting

One symmetric 32-byte **org vault key** per org protects _everything_, via a 3-layer chain
(`packages/credentials-crypto`):

```
passphrase ──Argon2id(t=3, m=64 MiB, p=1, 16B salt)──► KEK
   └─ XChaCha20-Poly1305 unseals ──► device X25519 private key   (~/.better-update/identity.json)
        └─ age (X25519) unwraps ──► ORG VAULT KEY (32B, ONE per org)
             └─ XChaCha20-Poly1305 unwraps ──► per-item DEK (32B)
                  └─ XChaCha20-Poly1305 opens ──► plaintext secret blob
```

- **Vault key**: random 32B (`generateVaultKey`), never derived from the passphrase, always
  **age-wrapped to recipients** (`wrapVaultKey`/`unwrapVaultKey`) — one wrap row per recipient
  in `org_vault_key_wraps` (PK `(organization_id, vault_version, user_encryption_key_id)`).
- **DEK model**: every credential and every `env_var_revision` gets its own random DEK,
  wrapped under the vault key with AEAD AAD-bound to `{orgId, credentialId, vaultVersion}`
  (`wrapDek`, domain `better-update/dek`). The payload is sealed under the DEK, AAD-bound to
  `{schemaVersion, orgId, credentialId, credentialType}` (`sealCredential`, domain
  `better-update/credential`). `envVarValue` is a 9th `credentialType` reusing the identical
  machinery (`apps/cli/src/application/credential-cipher.ts`).
- **Recipients** (`user_encryption_keys`, UNIQUE `public_key`), `kind ∈ {device, recovery,
machine}`; CHECK ties nullability (`device` → user-owned/org-null; `recovery`+`machine` →
  org-owned/user-null) — `apps/server/migrations/0046_credential_vault.sql`.
- **Shared `vault_version`** (`org_vaults.vault_version`, PK `organization_id`) is denormalized
  onto wrap rows **and** the `vault_version` column of all 8 credential tables **and**
  `env_var_revisions`. It is the single namespace tying creds + env together.
- **Rotation** (`repositories/org-vault.ts::rotate`, client `apps/cli/.../vault-rotation.ts`):
  one CAS-guarded D1 batch — new key, re-wrap **every** DEK across all 9 tables (coverage
  enforced), re-wrap to surviving recipients, bump version, clear pending.
- **`rotation_pending` gate** (migration 0064; `application/assert-vault-rotation.ts`): set on
  member removal/downgrade (`reconcile-vault-recipients.ts`); while set,
  `build-credentials.resolve` **and** `env-vars.export` fail closed (409).

### Why web is read-only today

Purely **key-material availability**, enforced cryptographically:

1. `apps/web` ships **zero crypto libs** — no `@noble`, no `age-encryption`, no Argon2id.
2. The `passphrase → device key → vault key` chain is CLI-anchored; the device private key
   never leaves `identity.json`.
3. `GET /api/env-vars/export` 403s non-bearer callers (`handlers/env-vars-helpers.ts:197`), and
   the web client ships **no** env mutation bindings (`packages/api-client/src/react/env-vars.ts`).

Goal #3 requires changing exactly this fact — **for env values only**.

## 2. Target architecture (two vaults, one passphrase)

|                        | Credentials Vault (CV)               | Env Vault (EV)                                 |
| ---------------------- | ------------------------------------ | ---------------------------------------------- |
| Protects               | the 8 signing-credential tables      | `env_var_revisions` only                       |
| Key                    | **= existing K, unchanged**          | **new key, ≠ K**                               |
| Recipients             | device, recovery, machine            | device, recovery, machine, **+ account**       |
| Browser can obtain key | **never**                            | yes (via account key)                          |
| Version / pending      | `vault_version` / `rotation_pending` | `env_vault_version` / `env_rotation_pending`   |
| Posture                | zero-knowledge, CLI-only (unchanged) | E2E-at-rest; relaxed vs. malicious-code server |

The passphrase is never a key — it is the Argon2id seed for a KEK that unseals a **private
key**. After the split there are two sealed private keys under the one passphrase:

```
                                 ┌─ device private key (identity.json, CLI) ─┬─► age-unwrap CV wrap  ─► CV key
passphrase ─Argon2id(salt_d)─► KEK_device ─────────────────────────────────┴─► age-unwrap EV wrap  ─► EV key   (CLI: everything)
passphrase ─Argon2id(salt_a)─► KEK_account ─► account private key (server escrow) ─► age-unwrap EV wrap ─► EV key (web: env only)
```

- **CV = the existing vault, byte-for-byte.** Its `vault_version`, wraps, and all credential
  DEKs are untouched. CV key keeps value `K`.
- **EV is a fresh key** wrapped to the same device/recovery/machine recipients **plus** each
  member's **account key**. Env DEKs are re-wrapped from `K`→EV at cutover (§7).
- **Account key** = a per-user keypair (age X25519 for unwrapping EV + Ed25519 reserved for
  future signed-roster integrity, §8), private halves sealed under the **same passphrase**
  (distinct salt) and stored **server-side** as an escrow blob the server can't open. The
  browser downloads the blob, runs Argon2id + age-unwrap locally → EV key → env CRUD.
- **"Same passphrase" is a real invariant:** one `credentials passphrase change` command
  re-seals **both** the device identity and the account escrow.

## 3. Crypto changes (`packages/credentials-crypto`) — P0

### 3.1 Vault-kind in the DEK binding (back-compat critical)

Add `vaultKind` to `DekBinding`, folded into the `better-update/dek` AAD — but **credentials
must reproduce the legacy AAD bytes** so every pre-split DEK still verifies:

```ts
export type VaultKind = "credentials" | "env";

export interface DekBinding {
  orgId: string;
  credentialId: string;
  vaultVersion: number;
  vaultKind: VaultKind;
}

const dekAad = (b: DekBinding): Uint8Array =>
  // 'credentials' = the pre-split AAD (no kind segment) → existing wraps verify unchanged.
  // 'env' folds in the kind so an EV DEK can never be opened under CV (defence-in-depth on
  // top of EV-key ≠ CV-key).
  b.vaultKind === "env"
    ? encodeAad("better-update/dek", [b.orgId, b.credentialId, b.vaultVersion, "env"])
    : encodeAad("better-update/dek", [b.orgId, b.credentialId, b.vaultVersion]);
```

All existing CV call sites (`credential-cipher.ts`) pass `vaultKind: "credentials"`; the env
path passes `"env"`. `wrapVaultKey`/`unwrapVaultKey`/`sealCredential`/`aead` are reused verbatim
by both vaults (the credential blob is **not** kind-bound — only the DEK wrap is, so cutover
re-wraps DEKs without re-encrypting `value_ciphertext`).

### 3.2 Account keypair seal/open (mirrors `sealIdentity`)

```ts
export interface AccountKeyMaterial {
  agePrivateKey: string; // AGE-SECRET-KEY-...
  agePublicKey: string; // age1...  (the EV recipient)
  ed25519PrivateKey: string; // base64 (reserved for §8 signing — generated now to avoid re-enroll)
  ed25519PublicKey: string; // base64
  fingerprint: string; // SHA256: of agePublicKey
}

/** Server-stored escrow envelope; server cannot open it (no passphrase). */
export interface AccountKeyEnvelope {
  version: 1;
  agePublicKey: string;
  ed25519PublicKey: string;
  fingerprint: string;
  kdf: "argon2id";
  kdfParams: Argon2Params;
  salt: string; // base64, distinct from the device salt
  cipher: "xchacha20poly1305";
  ct: string; // seals JSON {agePrivateKey, ed25519PrivateKey}, AAD-bound to the header
}

export const generateAccountKey: () => Promise<AccountKeyMaterial>;
export const sealAccountKey: (a: {
  material;
  passphrase;
  kdfParams?;
}) => Promise<AccountKeyEnvelope>;
export const openAccountKey: (a: { envelope; passphrase }) => Promise<AccountKeyMaterial>;
```

- Ed25519 via `@noble/curves/ed25519` (new dep; `@noble/hashes`+`@noble/ciphers` already present).
- **Stronger Argon2id for the account escrow** (server-stored ⇒ more exposed than on-disk
  `identity.json`): `ACCOUNT_ARGON2_PARAMS` default `{ time: 3, memory: 131_072 /*128 MiB*/, p: 1 }`.
  Params live **in the envelope**, so they can be tuned per-enrollment. Browser perf must be
  validated (pure-JS Argon2id at 128 MiB) — drop to 64 MiB or adopt a WASM Argon2id if it bites.
- The whole package must compile & run in the browser (it already is pure JS/WASM).

### 3.3 Tests (P0)

- Existing CV DEK blobs (no kind) still `unwrapDek` with `vaultKind: "credentials"`.
- An EV-bound DEK fails the tag when unwrapped as `"credentials"` and vice-versa.
- A DEK wrapped under EV key fails under CV key (key-difference defence) and vice-versa.
- `openAccountKey(sealAccountKey(x))` round-trips; wrong passphrase / tampered header fails.

## 4. DB schema (additive only — no drops, no live-table rebuild) — P1

Migration head is **0070**; new files start **0071**.

1. **`org_vaults`** — `ALTER TABLE ADD COLUMN` (purely additive):
   - `env_vault_version INTEGER NOT NULL DEFAULT 1`
   - `env_rotation_pending INTEGER NOT NULL DEFAULT 0`
   - `env_rotation_pending_since TEXT`
   - `env_rotation_pending_reason TEXT`
   - The existing `vault_version` / `rotation_pending*` columns are now **CV's**.
2. **`account_keys`** — NEW table (one active row per user, cross-org like device keys):
   `id, user_id (FK user ON DELETE CASCADE), age_public_key, ed25519_public_key, escrow_ct,
salt, kdf_params (TEXT json), fingerprint, created_at, last_used_at, revoked_at`.
   UNIQUE on `age_public_key`; partial UNIQUE `(user_id) WHERE revoked_at IS NULL` (one live
   account key per user). Holds the escrow blob — distinct from `user_encryption_keys` (which
   stores only public recipient keys).
3. **`org_env_vault_key_wraps`** — NEW table mirroring `org_vault_key_wraps` but with a
   **polymorphic recipient** so it can point at either a `user_encryption_keys.id`
   (device/recovery/machine) or an `account_keys.id`:
   `organization_id, env_vault_version, recipient_kind TEXT CHECK IN ('device','recovery',
'machine','account'), recipient_id TEXT, wrapped_key TEXT, created_at`,
   PK `(organization_id, env_vault_version, recipient_kind, recipient_id)`. No hard FK on
   `recipient_id` (polymorphic) — integrity enforced in the app layer + the CASCADE handled by
   the reconcile pass. Indexes mirror the CV wrap table.
4. **`env_var_revisions`** — **no column change.** Its existing `wrapped_dek` / `vault_version`
   are **re-keyed in place** to EV at cutover (§7): `vault_version` then tracks
   `env_vault_version`, `wrapped_dek` is the EV-wrapped DEK. `value_ciphertext` is untouched
   (not kind-bound).
5. The 8 signing tables are **unchanged**.

> Polymorphic-recipient rationale: putting account keys into `user_encryption_keys` would
> require rebuilding its `CHECK` (a SQLite 12-step recreate of a live, populated table — higher
> prod risk). A parallel wrap table + a separate `account_keys` table is fully additive.

## 5. Server API — P2

`apps/server` keeps its hexagonal layering (repos = port+Live; handlers = HTTP shell, never
throw, errors as Effect values via `http/to-api-effect.ts`).

### 5.1 Per-vault rotation & pending

- Generalize `OrgVaultRepo` ops with a `kind: VaultKind` param (or add `Env`-prefixed
  siblings): `getVault` returns both versions + both pending flags; `rotate(kind=…)` is its own
  CAS batch over its own wrap table + its own credential rows + its own version column. CV
  rotate is byte-identical to today for old clients.
- `CREDENTIAL_TABLES` splits: the 8 signing tables rotate under CV; `env_var_revisions` rotates
  under EV. Coverage enforced per vault.
- `assert-vault-rotation.ts`: `build-credentials.resolve` gates on **CV** `rotation_pending`;
  `env-vars.export` + the new web env path gate on **EV** `env_rotation_pending`. (Strictly
  better than today: an env-recipient revocation no longer blocks CI builds.)
- `reconcile-vault-recipients.ts` / `dropDeviceWrapsForUser`: **one** departure pass drops the
  user's wraps from **both** wrap tables (and their `account_keys` EV wrap) and sets **both**
  pending flags. Each vault must retain ≥1 recovery recipient (use the **same** org recovery
  key wrapped into both).

### 5.2 Account-key endpoints

- `POST /api/account-keys` — register `{agePublicKey, ed25519PublicKey, escrowCt, salt,
kdfParams, fingerprint}` (CLI-only, bearer). Server stores escrow opaquely.
- `GET /api/account-keys/me` — return the caller's escrow envelope. **Gated by the 2FA
  session-state middleware (§5.4)** — serving the escrow blob is the step-up trigger.
- The account key becomes an EV recipient via the normal grant path (CLI wraps EV to it).

### 5.3 Web env read/write path

The existing `export` stays **bearer-only** (do **not** loosen it). Add a **new web-scoped**
env path that:

- returns the **EV** envelopes (`{id, ciphertext, wrappedDek, vaultVersion}`) for read, and
  accepts sealed EV envelopes for create/update/delete (the browser seals/opens);
- is gated by **EV `env_rotation_pending`** (fail-closed) **and** the **2FA gate**;
- reuses the existing per-(project×environment) `assertEnvVarScopedPermission` authz.
- Mutations remain **env-value only**; recipient/rotation endpoints reject browser sessions.

### 5.4 2FA as a session gate (not a crypto gate)

2FA protects **access**, not the ciphertext (the passphrase-derived key does that). Enforce via
a **server-side session-state middleware gate**, **not** the better-auth `twoFactor` sign-in
hook — the hook misses OAuth, which is prod's only login path. Require step-up before: serving
the account escrow, and any web env read/write. Bearer (CLI/CI) callers are exempt by
construction.

## 6. CLI — P3 ✅ (code done; needs CLI-e2e before prod cutover)

- `credentials account create|link|show|reseal` — `create` generates the account keypair,
  `sealAccountKey` under the **verified device passphrase** (the "same passphrase" invariant),
  `POST /account-keys`, and self-links EV to it when the org has already cut over; `link`
  (re)grants EV to an existing key; `reseal` re-seals the escrow under a new passphrase (the
  remedy for multi-device drift / a mid-`passphrase change` failure).
- `credentials env-vault migrate|rotate|status` — `migrate` is the **cutover** (§7): unlock `K`,
  generate EV, wrap EV to every recipient (device/recovery/machine **+ account keys**), re-key
  every env DEK `K`→EV in place; server CAS-guards the cutover sentinel (idempotent re-run).
  `rotate` bumps the env version + re-wraps survivors; `status` shows the fork state.
- `credentials passphrase change` — re-seals the device identity (PRIMARY, saved first) and, best
  effort, the per-user account escrow; reports the escrow outcome so a network/passphrase issue
  degrades to a warning + `account reseal`, never a hard block or silent split.
- Env value ops (`set/get/update/pull/push/import/export`) route through
  `openEnvVaultSessionInteractive`: credentials vault pre-cutover (byte-identical), env vault
  after. The seal carries `vaultKind` so the server rejects a cross-vault write.
- Multi-vault session cache (`vault-cache.ts` is keyed per vault kind: CV + EV cache/lock
  independently). citty flags stay positive (`--yes`); never `git --no-verify`.
- **Deferred:** coupling `access revoke` (a specific recipient) to an automatic EV drop — today
  full member removal drops BOTH vaults server-side, and `env-vault rotate` re-keys survivors; a
  targeted single-recipient EV revoke is not yet a one-command flow.

## 7. Cutover (one-shot per org) — P5

Approved as a **one-shot cutover**, not gradual dual-wrap. Consequence: **after an org cuts
over, an un-upgraded CLI can no longer read that org's env values** (it would fetch the EV
envelope but only holds `K`). Credentials are **unaffected**. Sequencing:

1. **Ship server + additive migrations 0071+** (understand EV columns/tables). No behaviour
   change; every org still effectively single-vault until it cuts over.
2. **Per-org `env-vault migrate`** (admin/owner, CLI): generate EV, wrap to recipients, re-key
   env DEKs `K`→EV in place, bump `env_vault_version`. Set a **min-CLI-version floor** for env
   on that org so stragglers get a clear _“upgrade the CLI to vX to access env”_ error (not a
   crash).
3. **Enroll account keys** (`account create`) per member who needs web access; wrap EV to them.
4. **Flip web to read-write** for the cut-over org (ship browser crypto + CRUD bindings + 2FA
   gate + independent origin).

Because `value_ciphertext` is not kind-bound, the cutover only re-wraps DEKs — fast, and it
never touches the 8 credential tables. All migrations remain additive; the legacy CV-bound env
`wrapped_dek` is simply overwritten by the EV-bound one (a data UPDATE, not a schema drop),
honoring "no DB drops".

> Prod note (`project_prod_status`): real users since 2026-06-17. The cutover is a deliberate,
> coordinated re-key of **env** only; communicate the CLI-version floor before flipping.

## 8. Zero-knowledge boundary — state plainly to users

- **CV stays fully zero-knowledge.** Server holds only CV wraps (age blobs to CLI-only
  recipients), wrapped DEKs, and R2 ciphertext. No CV escrow, no browser path. **Unchanged.**
- **EV is E2E-at-rest but NOT zero-knowledge against a fully-malicious _code_ server.** A
  _passive_ breach (DB/R2 dump) still yields only ciphertext — the escrow, wraps, DEKs, and
  values are all unopenable without the passphrase. **But** the browser downloads unlock JS; a
  server serving trojaned JS could capture the passphrase at unlock and then open everything in
  EV. This is inherent to _any_ web client that decrypts E2E data.
- **Mitigations (raise the bar, don't eliminate code-forgery):** independent origin
  `vault.<host>` so the API server can't inject into the vault origin; strict **CSP + SRI**;
  strong Argon2id; and a **future** Ed25519-signed integrity layer (signed append-only
  recipient roster + signed env-var head pointer + version-bound canary) so the server can't
  forge/rollback/swap _data_ undetected. The Ed25519 account key is generated **now** (§3.2) so
  this layer needs no re-enroll later; its verification machinery is deferred past v1.
- **Honest one-liner:** _the CLI remains the only fully zero-knowledge client; web env CRUD
  trades some of that for usability, scoped to env values only — signing credentials are never
  exposed to the browser._ (Consistent with memory `project_zk_scope_boundary`.)

## 9. Implementation phases & risk

| Phase                   | Work                                                                                                                                                                                                                                                                                                                                  | Status                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0**                  | `vaultKind` AAD (back-compat) + account-key seal/open + Ed25519; browser-compat; unit tests.                                                                                                                                                                                                                                          | ✅ DONE — 27 crypto tests, full lint green.                                                                                                                                                                                                                                                                                         |
| **P1**                  | Additive migrations 0071+ (`org_vaults` cols, `account_keys`, `org_env_vault_key_wraps`).                                                                                                                                                                                                                                             | ✅ DONE — migration 0071 applied, schema codegen + overlay updated, `env_vault_cutover_at` fork sentinel added (pre-cutover orgs byte-identical to today).                                                                                                                                                                          |
| **P2 (server)**         | Account-key repo+endpoints; EV repo (cutover/rotate/grant/wraps/deks); env-vault group+handlers; per-vault coverage split (CV excludes env post-cutover); departure drops BOTH vaults atomically (device revoked only if dead in both); reconcile enumerates env-only recipients; env-export gated on the right vault's pending flag. | ✅ DONE — full lint green (15/15), env-gate unit-tested.                                                                                                                                                                                                                                                                            |
| **P2 (web path + 2FA)** | New web-scoped env read/write path; 2FA session-state middleware gate (cover OAuth).                                                                                                                                                                                                                                                  | ⏳ PENDING — needs a from-scratch 2FA/TOTP step-up system (none exists today).                                                                                                                                                                                                                                                      |
| **P3**                  | CLI `account create/link/show/reseal`, `env-vault migrate/rotate/status`, `passphrase change`, multi-vault cache; EV-aware env ops; + small additive server endpoints (`GET /account-keys`, `PATCH /account-keys/me` reseal) and a `vaultKind` write discriminator.                                                                   | ✅ DONE (code) — full lint 15/15; unit tests green (`env-vault-rekey` round-trip + cross-vault reject 3/3, `assert-vault-version` 9/9 incl. the version-collision case, plus existing 6/6 + CLI 17/17). Adversarially reviewed (16-agent workflow); all 6 confirmed findings fixed. ⏳ STILL NEEDS CLI-e2e before any prod cutover. |
| **P4**                  | Web crypto deps; passphrase(+2FA) unlock → account key → EV; env CRUD; CSP/SRI; origin.                                                                                                                                                                                                                                               | ⏳ PENDING — browser crypto + new independent origin deploy + CSP/SRI; needs browser/e2e verification.                                                                                                                                                                                                                              |
| **P5**                  | Per-org cutover rollout; enroll account keys; flip web; CLI version floor.                                                                                                                                                                                                                                                            | ⏳ PENDING — operational rollout after P3/P4 land.                                                                                                                                                                                                                                                                                  |

> **Verification note (server, P1+P2):** all additive — no drops, no live-table rebuild; the 8
> signing-credential tables are never touched; credential DEKs keep the legacy AAD bytes
> (`vaultKind:"credentials"`), so existing credentials verify unchanged. Existing **users** and
> **credentials** are unaffected; **env** is only re-keyed at the per-org cutover (P3), recoverable
> by upgrading the CLI. `bun run lint` = 15/15 green; `assert-vault-rotation.test.ts` = 6/6.

> **P3 review fixes (adversarial workflow, 6 confirmed findings, all fixed):**
>
> 1. **(P1) Version-namespace collision → silent env corruption.** CV and EV both start at version 1,
>    and the env value envelope carried only a numeric `vaultVersion`, so a credentials-keyed write
>    from an un-upgraded (or cutover-racing) CLI matched `envVaultVersion == 1` post-cutover and was
>    stored into an env row → permanently undecryptable. **Fix:** added optional `vaultKind` to
>    `EnvVarValueEnvelope` (additive); the CLI sends it; `assertEnvVaultWriteAllowed` now REQUIRES
>    `"env"` once forked (rejects absent/`"credentials"` with a clear upgrade Conflict) and rejects a
>    stray `"env"` pre-cutover. Pre-cutover stays byte-identical.
> 2. **(P2) `getMe` escrow had no permission gate** and the comments overclaimed a 2FA gate that does
>    not exist. **Fix:** added `assertPermission("vaultAccess","read")`; corrected comments/docstrings
>    to say the 2FA step-up is PENDING (P4) and the web consumer must not ship before it.
> 3. **(P2) Passphrase change could hard-block / silently split** across devices (per-user escrow vs
>    per-device passphrase) or on a local-save failure after a server reseal. **Fix:** local identity
>    save is now PRIMARY + first; the account reseal is best-effort and returns an outcome the CLI
>    warns on; added `credentials account reseal` as the explicit remedy.
> 4. **(P2) Cutover/rotate permission asymmetry** — a `delete`-but-not-`create` principal could rotate
>    and silently drop other members' device wraps (narrowed recipient view). **Fix:** both now also
>    require `vaultAccess:create`.
> 5. **(P2) Rotate TOCTOU** (concurrent env write orphaned). **Fix:** post-cutover env writes are
>    gated on `envRotationPending` (mirrors export), closing the member-removal→rotate window.
> 6. **(P2) Cutover TOCTOU** (µs server-side read→batch window). Documented; the `env-vault migrate`
>    command warns to avoid concurrent env writes during migration.

Source anchors: `packages/credentials-crypto/src/{vault,identity,credential,aead}.ts`;
`apps/server/migrations/0046_credential_vault.sql` + `0049_*` + `0064_*`;
`apps/server/src/repositories/org-vault.ts` (`rotate`, `dropDeviceWrapsForUser`,
`CREDENTIAL_TABLES`); `apps/server/src/application/{assert-vault-rotation,reconcile-vault-recipients}.ts`;
`apps/server/src/handlers/{org-vault,build-credentials,env-vars,env-vars-helpers}.ts`;
`apps/cli/src/application/{credential-cipher,vault-rotation,vault-access}.ts`;
`apps/cli/src/services/vault-cache.ts`; `packages/api-client/src/react/{env-vars,vault}.ts`.
