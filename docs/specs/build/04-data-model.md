# 4. Data Model (D1)

## Schema

```mermaid
erDiagram
    projects ||--o{ builds : has
    projects ||--o{ credentials : "scoped to (optional)"
    projects ||--o{ env_vars : has
    organization ||--o{ credentials : owns
    builds ||--o| build_artifacts : produces

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

    credentials {
        TEXT id PK "cred_UUIDv7"
        TEXT organization_id FK
        TEXT project_id FK "nullable, org-wide if null"
        TEXT platform "CHECK: ios | android"
        TEXT type "distribution-certificate | provisioning-profile | push-key | keystore | play-service-account"
        TEXT name "user-provided label"
        TEXT distribution "nullable; ad-hoc | app-store | development | enterprise | play-store | direct"
        INTEGER is_active "1 = active for its scope, DEFAULT 0"
        TEXT r2_key "credentials/{org_id}/{id} in BUILD_BUCKET"
        TEXT encrypted_dek "base64, encrypted with org KEK"
        INTEGER key_version "KEK version used to encrypt DEK"
        TEXT encrypted_password "base64, nullable (for .p12/.jks)"
        TEXT encrypted_key_alias "base64, nullable (for .jks)"
        TEXT encrypted_key_password "base64, nullable (for .jks)"
        TEXT metadata_json "extracted cert info, expiry, etc."
        TEXT expires_at "ISO 8601, nullable"
        TEXT created_at "ISO 8601"
    }

    env_vars {
        TEXT id PK "UUIDv7"
        TEXT project_id FK
        TEXT environment "production | preview | development | *"
        TEXT key "variable name"
        TEXT value "plaintext value, nullable"
        TEXT encrypted_value "base64, for sensitive and secret tiers, nullable"
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

CREATE TABLE credentials (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    type TEXT NOT NULL CHECK (type IN (
        'distribution-certificate', 'provisioning-profile', 'push-key',
        'keystore', 'play-service-account'
    )),
    name TEXT NOT NULL,
    distribution TEXT CHECK (distribution IN ('ad-hoc', 'app-store', 'development', 'enterprise', 'play-store', 'direct')),
    is_active INTEGER NOT NULL DEFAULT 0,
    r2_key TEXT NOT NULL,
    encrypted_dek TEXT NOT NULL,
    key_version INTEGER NOT NULL DEFAULT 1,
    encrypted_password TEXT,
    encrypted_key_alias TEXT,
    encrypted_key_password TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE env_vars (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    environment TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    encrypted_value TEXT,
    visibility TEXT NOT NULL DEFAULT 'plaintext' CHECK (visibility IN ('plaintext', 'sensitive', 'secret')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Build indexes
CREATE INDEX idx_builds_project ON builds(project_id, created_at DESC);
CREATE INDEX idx_builds_platform ON builds(project_id, platform, created_at DESC);
CREATE INDEX idx_builds_runtime ON builds(project_id, runtime_version);

-- Credential indexes
CREATE INDEX idx_credentials_org ON credentials(organization_id, platform);
CREATE INDEX idx_credentials_project ON credentials(project_id, platform) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX idx_credentials_active ON credentials(organization_id, COALESCE(project_id, ''), platform, type, COALESCE(distribution, '')) WHERE is_active = 1;

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

This metadata is stored as plaintext JSON in `credentials.metadata_json` in D1 for dashboard display. The raw blob is encrypted and stored in `BUILD_BUCKET` (private R2).

**Future**: Server-side extraction may be added as a verification step — comparing CLI-supplied metadata against values parsed from the uploaded blob.

### Credential secrets (password, key alias, key password)

Keystore password, key alias, and key password for `.p12`/`.jks` are stored encrypted alongside the DEK in D1 — not in HTTP response headers. The credential download endpoint (`GET /api/credentials/:id/download`) returns a JSON envelope with the base64-encoded blob + secrets. This endpoint is **API key auth only** (CLI) — session/cookie auth is rejected to prevent browser-side exfiltration.

### Credential activation

The `is_active` flag allows explicit credential selection. The activation scope is `(organization_id, project_id or NULL, platform, type, distribution)` — scoped per tenant to prevent cross-org collisions. `distribution` distinguishes profiles like `ad-hoc` vs `app-store` for the same project+platform+type. One project can have both an active `ad-hoc` provisioning profile and an active `app-store` provisioning profile simultaneously.

**`distribution` is nullable** for credential types that are not distribution-specific:

- **Distribution certificates** (iOS `.p12`): a single cert signs all distribution types → `distribution = NULL`
- **Push notification keys** (iOS `.p8`): not distribution-specific → `distribution = NULL`
- **Provisioning profiles** (iOS `.mobileprovision`): distribution-specific → `distribution = 'app-store' | 'ad-hoc' | 'development' | 'enterprise'`
- **Keystores** (Android `.jks`): a single keystore typically signs all builds → `distribution = NULL`
- **Play service accounts** (Android `.json`): not distribution-specific → `distribution = NULL`

Only one credential per scope can be active; activating a new one deactivates the previous within the same scope. If none is explicitly active, the most recently uploaded credential matching the scope is selected as default.

The database enforces this with a partial unique index:

```sql
CREATE UNIQUE INDEX idx_credentials_active
  ON credentials(COALESCE(project_id, ''), platform, type, COALESCE(distribution, ''))
  WHERE is_active = 1;
```

### `key_version` for rotation support

Each credential stores the `key_version` used to derive the KEK. The server maintains a versioned keyring of master secrets (see [02-credential-vault.md](./02-credential-vault.md)). On rotation, new credentials get the latest version. Existing credentials remain decryptable because the server selects the correct master secret from the keyring using the `key_version` stored on each record. Old master secrets are retired only after all credentials are re-encrypted to the latest version.

### Env var storage — all in D1

All env var tiers (plaintext, sensitive, secret) are stored in D1. Sensitive and secret values use the same org KEK encryption in `encrypted_value`. The only difference between sensitive and secret is dashboard visibility. R2 is not used for env vars — values are small strings (max 32 KB) that fit in D1 rows.

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
