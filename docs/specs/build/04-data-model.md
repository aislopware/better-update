# 4. Data Model (D1)

## Schema

```mermaid
erDiagram
    projects ||--o{ builds : has
    projects ||--o{ env_vars : has
    builds ||--o| build_artifacts : produces
    organization ||--o{ user_encryption_keys : registers
    organization ||--|| org_vaults : has
    org_vaults ||--o{ org_vault_key_wraps : wraps
    user_encryption_keys ||--o{ org_vault_key_wraps : recipient

    builds {
        TEXT id PK "UUIDv7"
        TEXT project_id FK
        TEXT platform "CHECK: ios | android"
        TEXT profile "e.g. production, preview"
        TEXT distribution "CHECK: app-store | ad-hoc | development | enterprise | simulator | play-store | direct"
        TEXT runtime_version "for OTA compatibility"
        TEXT app_version "CFBundleShortVersionString / versionName"
        TEXT build_number "CFBundleVersion / versionCode"
        TEXT bundle_id "CFBundleIdentifier / package"
        TEXT git_ref "branch name, nullable"
        TEXT git_commit "commit SHA, nullable"
        TEXT message "optional build note"
        TEXT metadata_json "additional metadata"
        TEXT created_at "ISO 8601"
    }

    build_artifacts {
        TEXT build_id PK FK
        TEXT r2_key "artifacts/{org_id}/{build_id}.{ext}"
        TEXT format "CHECK: ipa | apk | aab | tar.gz"
        TEXT content_type
        INTEGER byte_size
        TEXT sha256 "content hash"
        TEXT created_at "ISO 8601"
    }

    user_encryption_keys {
        TEXT id PK
        TEXT user_id FK "nullable (set for kind=device)"
        TEXT organization_id FK "nullable (set for kind=recovery or machine)"
        TEXT kind "device | recovery | machine"
        TEXT public_key "age recipient (age1...)"
        TEXT fingerprint "for out-of-band verification"
        TEXT label
        TEXT created_at "ISO 8601"
        TEXT last_used_at "ISO 8601, nullable"
        TEXT revoked_at "ISO 8601, nullable"
    }
    org_vaults {
        TEXT organization_id PK "one row per org"
        INTEGER vault_version "authoritative current version, CAS guard for rotation"
        TEXT created_at "ISO 8601"
        TEXT updated_at "ISO 8601"
    }
    org_vault_key_wraps {
        TEXT id PK
        TEXT organization_id FK
        INTEGER vault_version
        TEXT user_encryption_key_id FK
        TEXT wrapped_key "org vault key wrapped to this recipient (age)"
        TEXT created_at "ISO 8601"
    }

    env_vars {
        TEXT id PK "UUIDv7"
        TEXT project_id FK
        TEXT environment "production | preview | development | *"
        TEXT key "variable name"
        TEXT value "all tiers stored here, not encrypted at rest (see 0038)"
        TEXT visibility "CHECK: plaintext | sensitive | secret"
        TEXT created_at "ISO 8601"
        TEXT updated_at "ISO 8601"
    }
```

## Migration

```sql
-- 0005_builds.sql

CREATE TABLE builds (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    profile TEXT NOT NULL DEFAULT 'production',
    distribution TEXT NOT NULL CHECK (distribution IN ('app-store', 'ad-hoc', 'development', 'enterprise', 'simulator', 'play-store', 'direct')),
    runtime_version TEXT,
    app_version TEXT,
    build_number TEXT,
    bundle_id TEXT,
    git_ref TEXT,
    git_commit TEXT,
    message TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE build_artifacts (
    build_id TEXT PRIMARY KEY REFERENCES builds(id) ON DELETE CASCADE,
    r2_key TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('ipa', 'apk', 'aab', 'tar.gz')),
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    byte_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Credential MATERIAL lives in per-type tables (migrations 0017+): apple_distribution_certificates,
-- apple_push_keys, asc_api_keys, apple_provisioning_profiles, google_service_account_keys,
-- android_upload_keystores, android_build_credentials, ios_bundle_configurations. Each secret-bearing
-- table stores plaintext metadata + r2_key (client-encrypted ciphertext blob) + wrapped_dek +
-- vault_version. The server NEVER decrypts. See 02-credential-vault.md for the model and the migrations
-- for exact per-type DDL. The client-side E2E vault adds these three tables:

CREATE TABLE user_encryption_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES user(id) ON DELETE CASCADE,                  -- set for kind=device
    organization_id TEXT REFERENCES organization(id) ON DELETE CASCADE,  -- set for kind=recovery|machine
    kind TEXT NOT NULL CHECK (kind IN ('device', 'recovery', 'machine')),
    public_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_used_at TEXT,
    revoked_at TEXT
);

CREATE TABLE org_vaults (
    organization_id TEXT PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
    vault_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE org_vault_key_wraps (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    vault_version INTEGER NOT NULL,
    user_encryption_key_id TEXT NOT NULL REFERENCES user_encryption_keys(id) ON DELETE CASCADE,
    wrapped_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE env_vars (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    environment TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    visibility TEXT NOT NULL DEFAULT 'plaintext' CHECK (visibility IN ('plaintext', 'sensitive', 'secret')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Build indexes
CREATE INDEX idx_builds_project ON builds(project_id, created_at DESC);
CREATE INDEX idx_builds_platform ON builds(project_id, platform, created_at DESC);
CREATE INDEX idx_builds_runtime ON builds(project_id, runtime_version);

-- Vault / encryption-key indexes (per-type credential table indexes live in migrations 0017+)
CREATE INDEX idx_user_encryption_keys_user ON user_encryption_keys(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_user_encryption_keys_org ON user_encryption_keys(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX idx_vault_wraps_recipient ON org_vault_key_wraps(organization_id, user_encryption_key_id);

-- Env var indexes
CREATE UNIQUE INDEX idx_env_vars_unique ON env_vars(project_id, environment, key);
CREATE INDEX idx_env_vars_project ON env_vars(project_id, environment);
```

## Design Decisions

### No `status` column on builds — reservation-then-insert model

There is no queued/building/failed lifecycle. The upload flow works as:

1. `POST /api/builds` **reserves** a build ID and R2 staging key. The reservation (build ID, metadata, org context) is stored in a **KV namespace** (`BUILD_RESERVATIONS`) with a **3-hour TTL** — longer than the 2-hour presigned URL expiry to allow for the `/complete` call after upload finishes. **No D1 row is inserted yet.**
2. CLI uploads artifact directly to R2 at a **staging key** (`staging/{org_id}/{build_id}.{ext}`) via the presigned URL.
3. `POST /api/builds/:id/complete` reads the reservation from KV, verifies the R2 staging object exists and matches the expected size, **copies** it to the final key (`artifacts/{org_id}/{build_id}.{ext}`), inserts `builds` and `build_artifacts` rows in D1 atomically (if D1 fails, deletes the copied final object as compensating rollback), then deletes the staging object and KV reservation.

If the CLI never calls `/complete` (crash, timeout), only an orphaned R2 staging object and an expiring KV entry remain — no dangling D1 rows. The daily Cron handler cleans up R2 objects under `staging/` older than 2 hours.

### `runtime_version` as a top-level column

runtimeVersion is the key link between native builds and OTA updates. Stored as a first-class indexed column (not buried in `metadata_json`) for efficient joins with the `updates` table.

### Flat metadata columns vs JSON

`app_version`, `build_number`, `bundle_id`, `runtime_version` are top-level columns because they are displayed in every build list row, used for filtering, and used for OTA queries. Additional metadata (min SDK, Xcode version, etc.) goes in `metadata_json`.

### Artifact as separate table

`build_artifacts` is 1:1 with `builds` but separate because the artifact may be deleted by retention policy while the build record is preserved for history.

### Credential metadata — CLI-supplied (v1)

In v1, credential metadata is **supplied by the CLI** as form fields during upload, not extracted server-side. The CLI reads metadata from the local file before uploading:

- `.p12`: Common Name, serial number, expiry, team ID (via `openssl` or macOS `security` command)
- `.mobileprovision`: bundle ID, profile type, expiry, provisioned device count (via `security cms -D` on macOS)
- `.jks`: key alias, creation date (via `keytool -list`)

This metadata is stored as plaintext JSON in the per-type credential tables in D1 for dashboard display. The CLI must extract it locally because the server cannot read the blob: the secret bytes are encrypted **client-side** and only the ciphertext is stored in R2. See [02-credential-vault.md](./02-credential-vault.md).

**Future**: Server-side extraction may be added as a verification step — comparing CLI-supplied metadata against values parsed from the uploaded blob.

### Credential secrets (passwords)

Passwords (`.p12` export password, keystore + key passwords) are **folded into the client-encrypted blob** — there are no separate encrypted-password columns and the server never sees them. Download / `resolve` return ciphertext + the wrapped DEK; the CLI unwraps and decrypts locally. See [02-credential-vault.md](./02-credential-vault.md).

### Credential selection & binding

Selection is driven by **binding tables**, not a flat `is_active` flag on a single `credentials` table. `ios_bundle_configurations` binds (bundle id + distribution type) to a distribution certificate, provisioning profile, push key, and ASC key; `android_build_credentials` groups a keystore + FCM service account per application identifier (one group marked default). `build-credentials/resolve` resolves these on **plaintext metadata** (team/bundle matching, expiry, roster-hash staleness) and returns ciphertext for the CLI to decrypt. See [02-credential-vault.md](./02-credential-vault.md) and the per-type migrations for exact columns.

### Vault key rotation (`vault_version`)

There is no server-side keyring or KEK — the server holds no decryption key. Each encrypted credential carries a `vault_version`; rotation (always triggered by `revoke`) re-wraps every DEK under a new org vault key and bumps `org_vaults.vault_version` under a compare-and-swap guard. Recipients re-fetch their wrap. See [02-credential-vault.md](./02-credential-vault.md).

### Env var storage — all in D1

All env var tiers (plaintext, sensitive, secret) are stored as **plaintext** in D1 `env_vars.value` — server-side encryption was removed in migration 0038. The tier only controls dashboard masking + build-log redaction. R2 is not used for env vars — values are small strings (max 32 KB) that fit in D1 rows. See [03-environment-variables.md](./03-environment-variables.md).

## Retention

### Build Artifacts

| Profile     | Default retention | Behavior                                         |
| ----------- | ----------------- | ------------------------------------------------ |
| production  | 90 days           | Artifact deleted from R2, build record preserved |
| preview     | 30 days           | Artifact deleted from R2, build record preserved |
| development | 7 days            | Artifact deleted from R2, build record preserved |

A Cron handler runs daily to delete expired artifacts.

### Credentials

No automatic expiry deletion. Expired credentials are flagged in the dashboard but kept until manually deleted. The CLI warns when pulling expired credentials.
