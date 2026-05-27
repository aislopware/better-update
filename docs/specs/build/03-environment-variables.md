# 3. Environment Variables

## Overview

Environment variables configure the JS bundle and native build at compile time. better-update
stores them **end-to-end encrypted**, the same way as the credential vault
([02-credential-vault.md](./02-credential-vault.md)): all encryption and decryption happen in the
CLI on the user's machine, the server is **zero-knowledge** (it stores only ciphertext + wrapped
DEKs + non-secret metadata and can never decrypt a value), and the **web dashboard is read-only** —
it shows metadata only and performs no mutations.

Values are also **versioned**: every change appends a revision, the active value points at one
revision, and you can roll back to an earlier one. Env var revisions are bound to the same **org
vault key** as credentials, so a single `credentials access grant` unlocks both, and a vault rotation
re-wraps env var values along with credentials.

> **Why E2E.** A compromise of the better-update server (database, environment) yields only
> ciphertext and public keys. Plaintext values never leave the developer's machine. This replaces
> the previous design where env vars were stored plaintext in D1 and were server-visible.

## Visibility Tiers

Under E2E the value is **always encrypted at rest**; the tier no longer controls storage — it is a
**redaction hint** for the CLI's build-log output and the dashboard:

| Tier          | Dashboard     | CLI `env get` / logs | Storage        |
| ------------- | ------------- | -------------------- | -------------- |
| **Plaintext** | metadata only | Shown                | Encrypted (D1) |
| **Sensitive** | metadata only | Masked (`••••••`)    | Encrypted (D1) |

All values are end-to-end encrypted regardless of tier. The dashboard never shows any value (it has
no vault key); the tier only changes how the CLI prints the value once it has decrypted it locally.

> `EXPO_PUBLIC_*` keys are inlined into the JS bundle by Metro, so their values are not truly secret —
> but they are still encrypted at rest for a uniform model. `env push` classifies `EXPO_PUBLIC_*` as
> `plaintext` and everything else as `sensitive`.

### Storage

Two D1 tables, mirroring the credential vault's split of public metadata vs. encrypted payload:

- **`env_vars`** — public metadata (key, environment, scope, visibility) + a `current_revision_id`
  pointer. No value column.
- **`env_var_revisions`** — one row per value revision: the AEAD ciphertext (the typed payload sealed
  with a per-value DEK), the DEK wrapped under the org vault key, and the `vault_version` it was
  sealed at.

Ciphertext is stored **inline in D1** (values are small — ≤ 32 KB plaintext), not R2. The encryption
primitives are the shared `@better-update/credentials-crypto` package (XChaCha20-Poly1305 + age),
identical to credentials; the sealed payload's AAD binds it to `(orgId, revisionId, type)` so the
server cannot swap one revision's blob for another.

## Versioning & rollback

- Each value change (`env set`, `env push`, `env update --value`, `env import`) appends a new
  revision and advances `current_revision_id`. History is capped (last N revisions per var; older
  ones are pruned).
- `env history KEY --environment <env>` lists the revision history (metadata only — number, vault
  version, who, when). `env rollback KEY --to <revision#|id>` re-points the active value at an
  earlier retained revision (no re-encryption needed; the revision's DEK is already current).
- **Vault rotation re-wraps every retained revision's DEK**, so rollback stays decryptable after a
  rotation and a revoked recipient can no longer decrypt any past value.

## Environments

Each project has named environments mapping to build profiles:

| Environment   | Typical use                         |
| ------------- | ----------------------------------- |
| `development` | Local dev, debug builds             |
| `preview`     | Internal testing, ad-hoc/TestFlight |
| `production`  | App Store / Play Store release      |

A variable's identity is `(scope, key, environment)` — the environment is immutable after creation
(delete + recreate to move it). The same key holds an independent value per environment.

## Injection Points

The CLI **decrypts** the variables locally and exports them as shell environment variables before
running `expo prebuild` and the native build. This requires vault access (a granted recipient).

### Metro Bundler (JS bundle)

`EXPO_PUBLIC_`-prefixed variables are inlined into the JS bundle by Metro, accessible via
`process.env.EXPO_PUBLIC_*`.

### Native Build

Non-prefixed variables are available to `app.config.js/ts` (via `process.env`) and Gradle
(`System.getenv()`).

## CLI Flow

```
$ better-update build --platform ios --profile production

  Unlocking vault…                       (decrypts env vars locally)
  Pulling environment variables for "production"...
  ✓ 5 variables exported
```

The CLI:

1. `GET /api/env-vars/export?projectId=X&environment=production` — **API-key/CLI bearer auth only**
   (session/cookie auth is rejected). Returns the sealed envelopes (`ciphertext`, `wrappedDek`,
   `vaultVersion`) per variable, with `environment: "*"`-style globals merged in (project values win
   on key collision).
2. The CLI unlocks the org vault key (passphrase, or `BETTER_UPDATE_IDENTITY` in CI) **once**, then
   decrypts every envelope locally, re-checking the sealed `(key, environment)` against the row.
3. Exports each as `export KEY=VALUE` into the build subprocess.

Reads (`env pull`, `env export`, `env get`, `env exec`, build/update flows) decrypt locally; writes
(`env set`, `env push`, `env import`, `env update`) seal locally before upload. All require vault
access — a member with no vault grant can see metadata but cannot read or write values.

## Validation Rules

| Rule                                          | Reason                          |
| --------------------------------------------- | ------------------------------- |
| Key must match `^[A-Z][A-Z0-9_]*$`            | Shell-safe, conventional        |
| Key cannot be `PATH`, `HOME`, `USER`, `SHELL` | Overriding breaks the build env |
| Max key length: 256 chars                     | Practical limit                 |
| Max value length: 32 KB                       | D1 row size consideration       |
| Max vars per project / org-global: 100        | Prevent abuse                   |
| Unique on (scope, key, environment)           | No duplicates                   |
| Environment is immutable after creation       | It is part of the identity      |

## Dashboard UI (read-only)

The environment-variables page (per project + an org-global page) shows **metadata only**:

- Table: key, environment, scope (with an "overrides global" marker), visibility badge, revision
  count.
- Search by key, filter by environment, filter by scope.
- **No value is ever shown, and there is no add / edit / delete / import / export.** Where the old UI
  had mutation dialogs, the page shows a hint that values are managed with the CLI
  (`better-update env set` / `env pull`). This is enforced cryptographically: the browser has no vault
  key, so it could not produce ciphertext even if it tried.

## Migration (clean break)

Production has no real users yet, so no backward compatibility is required. Migration `0049` drops the
plaintext `env_vars` table and recreates it as metadata + `env_var_revisions` (encrypted). Existing
plaintext values cannot be migrated to E2E (the server has no vault key), so env var data is **reset**;
users re-set values via the CLI after deploy.
