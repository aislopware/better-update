# 5. API Endpoints

## Build Management

| Method | Path                       | Purpose                                             | Auth                       |
| ------ | -------------------------- | --------------------------------------------------- | -------------------------- |
| POST   | `/api/builds`              | Reserve build ID + get presigned staging upload URL | API key / session          |
| POST   | `/api/builds/:id/complete` | Finalize build after artifact upload                | API key / session          |
| GET    | `/api/builds`              | List builds for project                             | API key / session          |
| GET    | `/api/builds/:id`          | Get build details                                   | API key / session          |
| DELETE | `/api/builds/:id`          | Delete build + artifact                             | API key / session          |
| GET    | `/api/builds/:id/artifact` | Download build artifact                             | API key / session          |
| GET    | `/api/builds/:id/install`  | iOS OTA install manifest (itms-services)            | None (signed token in URL) |

## Credential Management

Credentials are **end-to-end encrypted**: the CLI encrypts client-side and the server stores only ciphertext + a wrapped DEK + `vault_version` + plaintext metadata, and **never decrypts**. The full design (key architecture, server-relay upload, ciphertext download/resolve, recipient/access model) is canonical in [02-credential-vault.md](./02-credential-vault.md); exact request/response shapes live in `@better-update/api`. The table below is summary-level.

| Method | Path                            | Purpose                                                                        | Auth              |
| ------ | ------------------------------- | ------------------------------------------------------------------------------ | ----------------- |
| POST   | `/api/credentials`              | Upload credential (server-relay: ciphertext + wrappedDek + metadata)           | API key / session |
| GET    | `/api/credentials`              | List credentials (plaintext metadata only, never ciphertext)                   | API key / session |
| GET    | `/api/credentials/:id`          | Get credential metadata                                                        | API key / session |
| GET    | `/api/credentials/:id/download` | Download credential **ciphertext** + wrappedDek (Worker-relayed; CLI decrypts) | API key / session |
| DELETE | `/api/credentials/:id`          | Delete credential (R2 ciphertext + D1 row)                                     | API key / session |

### Vault identities & access

Client-side E2E adds endpoints for per-device identity keys and per-org vault-key wraps. Shapes are defined in `@better-update/api` (`userEncryptionKeys` + `orgVault` groups); see [02-credential-vault.md](./02-credential-vault.md) for semantics.

| Method | Path                            | Purpose                                                                       | Auth              |
| ------ | ------------------------------- | ----------------------------------------------------------------------------- | ----------------- |
| POST   | `/api/encryption-keys`          | Register a recipient public key (device/recovery/machine)                     | API key / session |
| GET    | `/api/encryption-keys`          | List recipient keys (public keys + fingerprints + last-used)                  | API key / session |
| DELETE | `/api/encryption-keys/:id`      | Revoke a recipient key (flags vault rotation-pending)                         | API key / session |
| GET    | `/api/orgs/:orgId/vault`        | Get current `vault_version` + this recipient's wrapped vault key              | API key / session |
| POST   | `/api/orgs/:orgId/vault/wraps`  | Add a wrap row (grant / device-link) — authz below; version-guarded           | API key / session |
| POST   | `/api/orgs/:orgId/vault/rotate` | Atomic rotation: new wrap rows + bulk DEK re-wrap + new `vault_version` (CAS) | API key / session |

## Environment Variable Management

| Method | Path                   | Purpose                                       | Auth              |
| ------ | ---------------------- | --------------------------------------------- | ----------------- |
| POST   | `/api/env-vars`        | Create env var                                | API key / session |
| GET    | `/api/env-vars`        | List env vars for project+environment         | API key / session |
| PATCH  | `/api/env-vars/:id`    | Update env var value/visibility               | API key / session |
| DELETE | `/api/env-vars/:id`    | Delete env var                                | API key / session |
| POST   | `/api/env-vars/import` | Bulk import from `.env` format                | API key / session |
| GET    | `/api/env-vars/export` | Bulk export all values as JSON (for CLI pull) | **API key only**  |

## Authentication

Same as existing management API:

| Method             | Header                                           | Use case  |
| ------------------ | ------------------------------------------------ | --------- |
| **Session cookie** | `cookie: __Secure-better-auth.session_token=...` | Dashboard |
| **API key**        | `Authorization: Bearer bu_...`                   | CLI       |

**CLI-only endpoints**: The following endpoint returns plaintext secret values and is restricted to **API key auth only**. Session/cookie auth is rejected with `403` to prevent browser-side exfiltration. Responses include `Cache-Control: no-store`.

| Endpoint                   | Reason                                  |
| -------------------------- | --------------------------------------- |
| `GET /api/env-vars/export` | Returns plaintext secret env var values |

The credential download/resolve endpoints return only **ciphertext** the server cannot read, so they are not browser-exfiltration risks; they accept API key or session auth and the CLI decrypts locally with its device identity key (see [02-credential-vault.md](./02-credential-vault.md)). Responses still set `Cache-Control: no-store`.

## RBAC Permissions

New permission scopes to add to the existing auth spec ([server spec 21](../server/21-authentication.md)):

| Permission            | Owner | Admin | Developer | Viewer |
| --------------------- | ----- | ----- | --------- | ------ |
| `build:create`        | ✓     | ✓     | ✓         | ✗      |
| `build:read`          | ✓     | ✓     | ✓         | ✓      |
| `build:delete`        | ✓     | ✓     | ✗         | ✗      |
| `credential:create`   | ✓     | ✓     | ✗         | ✗      |
| `credential:read`     | ✓     | ✓     | ✓         | ✗      |
| `credential:download` | ✓     | ✓     | ✓         | ✗      |
| `credential:delete`   | ✓     | ✓     | ✗         | ✗      |
| `vault:grant`         | ✓     | ✓     | ✗         | ✗      |
| `vault:revoke`        | ✓     | ✓     | ✗         | ✗      |
| `envVar:create`       | ✓     | ✓     | ✓         | ✗      |
| `envVar:read`         | ✓     | ✓     | ✓         | ✓      |
| `envVar:export`       | ✓     | ✓     | ✓         | ✗      |
| `envVar:update`       | ✓     | ✓     | ✓         | ✗      |
| `envVar:delete`       | ✓     | ✓     | ✗         | ✗      |

Key decisions:

- **Credential download** requires `credential:download` (not just `credential:read`) — fetching the (encrypted) blob is a privileged operation separate from viewing metadata. The payload is ciphertext only; possession of a device identity key + a vault wrap is what actually enables decryption (see [02-credential-vault.md](./02-credential-vault.md)).
- **Vault grant/revoke** (`vault:grant` / `vault:revoke`) are gated to **admin/owner**: granting another user or a CI machine key, and running revoke (which always rotates the vault). Self-linking your _own_ new device needs no admin and is enforced cryptographically (target key shares your user, requires an existing device that holds the vault key). All grants/revokes are audit-logged.
- **Viewers** can see build list and env var keys but cannot download credentials or export env var values
- **Developers** can create builds and read credentials (needed for CLI build flow) but cannot delete credentials

---

## Endpoint Details — Builds

### POST /api/builds — Reserve Build Upload

Reserves a build ID and R2 staging key, stores the reservation in KV (`BUILD_RESERVATIONS`, 3-hour TTL), and returns a presigned R2 URL targeting the staging prefix. **No D1 row is inserted** — the build record is only created when `/complete` is called. The artifact is uploaded directly to `BUILD_BUCKET`, bypassing Worker body size limits.

```
POST /api/builds
Authorization: Bearer bu_...
Content-Type: application/json

{
  "projectId": "uuid",
  "platform": "ios",
  "profile": "production",
  "distribution": "app-store",
  "runtimeVersion": "1.2.0",
  "appVersion": "1.2.0",
  "buildNumber": "42",
  "bundleId": "com.example.app",
  "artifactFormat": "ipa",
  "message": "v1.2.0 release build",
  "gitRef": "main",
  "gitCommit": "abc123",
  "gitDirty": false,
  "metadata": { "xcode": "16.4", "sdk": "ios17" },
  "sha256": "4f8c5e6d...",
  "byteSize": 52428800
}
```

Response `201 Created`:

```json
{
  "id": "01JXYZ...",
  "uploadMode": "single",
  "uploadUrl": "https://build-bucket.r2.cloudflarestorage.com/staging/org123/01JXYZ....ipa?X-Amz-...",
  "uploadExpiresAt": "2026-04-11T13:00:00.000Z",
  "uploadHeaders": {
    "content-type": "application/octet-stream",
    "x-amz-checksum-sha256": "T4xe..."
  }
}
```

The `uploadUrl` is a **presigned R2 single-PUT URL** targeting a **staging prefix** (`staging/{org_id}/{build_id}.{ext}`), valid for **2 hours**. The client must send the exact `uploadHeaders` returned by the server. These currently include:

- `content-type`
- `x-amz-checksum-sha256`

**Why staging prefix**: The presigned PUT URL is reusable until expiry. Using a staging prefix means the artifact is not yet "live" — `/complete` copies it to the final `artifacts/` key and deletes the staging object. This prevents mutation of finalized artifacts.

The CLI uploads the artifact directly:

```bash
curl -X PUT \
  -H "Content-Type: application/octet-stream" \
  -H "x-amz-checksum-sha256: $CHECKSUM_BASE64" \
  --data-binary @MyApp.ipa "$UPLOAD_URL"
```

**Presigned URL contract:**

- Generated using R2's S3-compatible API via `@aws-sdk/s3-request-presigner` with R2 API credentials (access key ID + secret, configured as Worker secrets)
- Target key: `staging/{org_id}/{build_id}.{ext}` (staging prefix — promoted to `artifacts/` on `/complete`)
- Signed headers: `Content-Type`, `x-amz-checksum-sha256`
- Expiry: 2 hours (handles worst-case 500 MB on slow connections with retry margin)
- Reuse safety: the URL targets a staging key, so reuse before `/complete` merely overwrites the staging object; after `/complete` the staging object is deleted and the final artifact is immutable
- If the URL expires before upload completes, the CLI must call `POST /api/builds` again to get a fresh URL and reservation (the previous KV reservation expires naturally after 3 hours; orphaned staging objects are cleaned by Cron)

### POST /api/builds/:id/complete — Finalize Build

After the artifact is uploaded to R2, the CLI calls this endpoint to finalize:

```
POST /api/builds/01JXYZ.../complete
Authorization: Bearer bu_...
Content-Type: application/json

{
  "sha256": "abc123...",
  "byteSize": 52428800
}
```

Server-side:

1. Read reservation from KV (`BUILD_RESERVATIONS`) using the build ID. Return `404` if expired or missing.
2. Verify the R2 **staging** object exists at `staging/{org_id}/{build_id}.{ext}`
3. Verify `byteSize` matches the R2 object size
4. Verify the R2 object's stored SHA-256 checksum matches the reserved checksum
5. **Copy** the staging object to the final key (`builds/{org_id}/{project_id}/{build_id}.{ext}`)
6. **Insert `builds` and `build_artifacts` rows in D1 atomically** (this is when the build record is created — see [data model](./04-data-model.md)). If the D1 insert fails, **delete the copied final object** (compensating rollback) and return `500`.
7. **Delete** the staging object (only after D1 commit succeeds — if this delete fails, staging cleanup happens via Cron, no data loss)
8. Delete the KV reservation (best-effort — TTL handles eventual cleanup)
9. Return the complete build record

Response `200 OK`: full build record (same shape as `GET /api/builds/:id`).

Response `409 Conflict`: if `/complete` has already been called for this build ID (idempotent guard — D1 row already exists).

If the CLI never calls `/complete` (crash, timeout), only an orphaned R2 staging object and an expiring KV entry remain — no dangling D1 rows. The daily Cron handler cleans up R2 objects under `staging/` older than 2 hours.

**Integrity model**: The CLI computes SHA-256 locally, the server signs that checksum into the presigned upload contract, and `/complete` verifies the checksum reported by R2 metadata. The Worker does **not** stream and hash the uploaded body itself.

### GET /api/builds — List Builds

```
GET /api/builds?projectId=uuid&platform=ios&profile=production&runtimeVersion=1.2.0&limit=20&cursor=...
```

### GET /api/builds/:id/artifact — Download Artifact

Returns `302 Found` redirect to presigned R2 URL (15-minute expiry). Returns `404` if artifact deleted by retention.

**Auth**: API key or session. Additionally accepts a **signed token** in the URL (`?token=<base64>&expires=<unix>`) for unauthenticated public downloads (used for Android APK QR code install links). The token uses the same HMAC-SHA256 mechanism as the iOS install endpoint — scoped to buildId, 1-hour expiry.

### GET /api/builds/:id/install — iOS OTA Install

Serves `itms-services://` manifest plist for ad-hoc and enterprise distribution builds only. Returns `400` for app-store or simulator builds.

**Install token contract:**

- Token format: HMAC-SHA256 signature over `buildId + expiresAt`, using a server-side signing key
- Token expiry: 1 hour (short-lived to limit sharing)
- URL format: `GET /api/builds/:id/install?token=<base64>&expires=<unix>`
- The manifest plist embeds a **fresh presigned R2 download URL** generated at request time (not a static URL), so the artifact URL expires independently
- Only builds with `distribution: "ad-hoc"` or `"enterprise"` are installable via this endpoint

See [Artifact Management](./06-artifact-management.md) for QR code and install flow details.

---

## Endpoint Details — Credentials

All credential material is **end-to-end encrypted client-side**. The server stores only ciphertext + a wrapped DEK + `vault_version` + plaintext metadata and never decrypts. Per-type tables (`apple_distribution_certificates`, `apple_push_keys`, `asc_api_keys`, `apple_provisioning_profiles`, `google_service_account_keys`, `android_upload_keystores`, plus binding rows) replace the single `credentials` table. Exact request/response schemas are defined in `@better-update/api`; the flows below are summary-level — see [02-credential-vault.md](./02-credential-vault.md) for the canonical detail.

### POST /api/credentials — Upload Credential (server-relay)

The CLI parses the credential, extracts metadata, generates a per-credential DEK, AEAD-encrypts the bytes (passwords folded into the blob, no separate password field), and wraps the DEK with the org vault key. It then POSTs **ciphertext + wrappedDek + vaultVersion + plaintext metadata** as JSON (no multipart file, no plaintext password). The Worker validates metadata shape + authz + size cap, **generates the R2 key** (`credentials/{org}/{id}.enc`), and writes R2 + D1 atomically (on D1 failure it deletes the R2 object). The body is opaque ciphertext — the Worker never sees plaintext. Uploading requires vault access (a wrap row); a stale `vaultVersion` is rejected and the CLI re-wraps under the current key and retries.

Response `201 Created`: the credential **metadata record** (id, type, scope, plaintext metadata, `vaultVersion`, `createdAt`) — never any key material. The CLI self-decrypts the just-uploaded blob to confirm wrap-consistency.

### GET /api/credentials — List Credentials

```
GET /api/credentials?projectId=uuid&platform=ios&type=provisioning-profile&distribution=app-store
```

Query parameters:

| Param          | Type                 | Required | Description                                                                                                                                                     |
| -------------- | -------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectId`    | `string`             | No       | Filter by project. When provided, returns both project-scoped AND org-wide (`project_id IS NULL`) credentials. When omitted, returns org-wide credentials only. |
| `platform`     | `"ios" \| "android"` | No       | Filter by platform                                                                                                                                              |
| `type`         | `string`             | No       | Filter by credential type (e.g., `distribution-certificate`, `keystore`)                                                                                        |
| `distribution` | `string`             | No       | Filter by distribution method (e.g., `app-store`, `ad-hoc`, `play-store`)                                                                                       |

Returns plaintext **metadata only** — **never** ciphertext or wrapped DEKs.

### GET /api/credentials/:id/download — Download Credential (ciphertext)

Returns the credential **ciphertext + wrappedDek + vaultVersion + metadata** (the blob is relayed through the Worker from R2). The server cannot read it; the CLI unwraps the DEK with the org vault key (AAD-checked), decrypts locally, and re-verifies the metadata matches. Response sets `Cache-Control: no-store`. The previous server-side decryption path (KEK/keyring lookup, server-decrypted JSON envelope with plaintext passwords) is **removed**.

### Vault identity & access endpoints

Recipient-key registration (`/api/encryption-keys`), per-org wrapped-key fetch (`GET /api/orgs/:orgId/vault`), grant/device-link wrap rows (`POST /api/orgs/:orgId/vault/wraps`), and atomic rotation (`POST /api/orgs/:orgId/vault/rotate`) are all defined in `@better-update/api`. The server only relays opaque `age` wraps and enforces authz (own-device self-link OR admin/owner) + the `vault_version` compare-and-swap; it never holds an unwrapped vault key. See [02-credential-vault.md](./02-credential-vault.md).

---

## Endpoint Details — Environment Variables

### POST /api/env-vars — Create

```json
{
  "projectId": "uuid",
  "environment": "production",
  "key": "EXPO_PUBLIC_API_URL",
  "value": "https://api.example.com",
  "visibility": "plaintext"
}
```

### GET /api/env-vars — List

```
GET /api/env-vars?projectId=uuid&environment=production
```

Returns all variables. Sensitive values masked. Secret values show key name only (no value).

### GET /api/env-vars/export — Export for CLI

```
GET /api/env-vars/export?projectId=uuid&environment=production
```

Returns **all values** as a flat JSON object (env vars are stored plaintext — see migration 0038 / [03-environment-variables](./03-environment-variables.md)). The CLI uses this to export before building.

```json
{
  "EXPO_PUBLIC_API_URL": "https://api.example.com",
  "SENTRY_AUTH_TOKEN": "actual-secret-value",
  "APP_VARIANT": "production"
}
```

### POST /api/env-vars/import — Bulk Import

```
POST /api/env-vars/import
Content-Type: text/plain

projectId=uuid
environment=production
visibility=sensitive

EXPO_PUBLIC_API_URL=https://api.example.com
SENTRY_DSN=https://xxx@sentry.io/123
```

Parses `.env` format. Lines starting with `#` are ignored.

---

## Rate Limits

| Endpoint                                         | Limit | Window                 |
| ------------------------------------------------ | ----- | ---------------------- |
| `POST /api/builds` (upload)                      | 30    | per hour per project   |
| `GET /api/builds` (list)                         | 120   | per minute per project |
| `POST /api/credentials` (upload)                 | 20    | per hour per org       |
| `GET /api/credentials/:id/download` (ciphertext) | 30    | per minute per org     |
| `POST /api/orgs/:orgId/vault/rotate`             | 10    | per hour per org       |
| `POST /api/env-vars`                             | 100   | per hour per project   |

## Error Responses

| Status | Condition                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------------------------- |
| `400`  | Invalid platform/format, missing required fields, invalid env var key format, install endpoint called for non-ad-hoc build |
| `401`  | Missing or invalid authentication                                                                                          |
| `403`  | Insufficient permissions (RBAC), or session auth used on CLI-only endpoint                                                 |
| `404`  | Resource not found (also used for cross-org access attempts — never `403` for resources in other orgs)                     |
| `409`  | Duplicate env var key in same project+environment, or duplicate `/complete` call for same build                            |
| `413`  | Artifact exceeds 500 MB                                                                                                    |
| `422`  | Corrupt credential file, invalid metadata                                                                                  |
| `429`  | Rate limit exceeded                                                                                                        |
