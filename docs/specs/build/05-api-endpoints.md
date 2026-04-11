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

| Method | Path                            | Purpose                                        | Auth              |
| ------ | ------------------------------- | ---------------------------------------------- | ----------------- |
| POST   | `/api/credentials`              | Upload credential (multipart: file + metadata) | API key / session |
| GET    | `/api/credentials`              | List credentials (metadata only, never blobs)  | API key / session |
| GET    | `/api/credentials/:id`          | Get credential metadata                        | API key / session |
| GET    | `/api/credentials/:id/download` | Download decrypted credential blob + secrets   | **API key only**  |
| POST   | `/api/credentials/:id/activate` | Set credential as active for its scope         | API key / session |
| DELETE | `/api/credentials/:id`          | Delete credential (R2 + D1)                    | API key / session |

## Environment Variable Management

| Method | Path                   | Purpose                                                 | Auth              |
| ------ | ---------------------- | ------------------------------------------------------- | ----------------- |
| POST   | `/api/env-vars`        | Create env var                                          | API key / session |
| GET    | `/api/env-vars`        | List env vars for project+environment                   | API key / session |
| PATCH  | `/api/env-vars/:id`    | Update env var value/visibility                         | API key / session |
| DELETE | `/api/env-vars/:id`    | Delete env var                                          | API key / session |
| POST   | `/api/env-vars/import` | Bulk import from `.env` format                          | API key / session |
| GET    | `/api/env-vars/export` | Bulk export all values decrypted as JSON (for CLI pull) | **API key only**  |

## Authentication

Same as existing management API:

| Method             | Header                                           | Use case  |
| ------------------ | ------------------------------------------------ | --------- |
| **Session cookie** | `cookie: __Secure-better-auth.session_token=...` | Dashboard |
| **API key**        | `Authorization: Bearer bu_...`                   | CLI       |

**CLI-only endpoints**: The following endpoints return decrypted secrets and are restricted to **API key auth only**. Session/cookie auth is rejected with `403` to prevent browser-side exfiltration of signing material. Responses include `Cache-Control: no-store`.

| Endpoint                            | Reason                                         |
| ----------------------------------- | ---------------------------------------------- |
| `GET /api/credentials/:id/download` | Returns decrypted credential blobs + passwords |
| `GET /api/env-vars/export`          | Returns decrypted secret env var values        |

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
| `credential:activate` | ✓     | ✓     | ✗         | ✗      |
| `envVar:create`       | ✓     | ✓     | ✓         | ✗      |
| `envVar:read`         | ✓     | ✓     | ✓         | ✓      |
| `envVar:export`       | ✓     | ✓     | ✓         | ✗      |
| `envVar:update`       | ✓     | ✓     | ✓         | ✗      |
| `envVar:delete`       | ✓     | ✓     | ✗         | ✗      |

Key decisions:

- **Credential download** requires `credential:download` (not just `credential:read`) — downloading decrypted secrets is a privileged operation separate from viewing metadata
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
  "metadata": { "xcode": "16.4", "sdk": "ios17" }
}
```

Response `201 Created`:

```json
{
  "id": "01JXYZ...",
  "uploadUrl": "https://build-bucket.r2.cloudflarestorage.com/staging/org123/01JXYZ....ipa?X-Amz-...",
  "uploadExpiresAt": "2026-04-11T13:00:00.000Z"
}
```

The `uploadUrl` is a **presigned R2 PUT URL** targeting a **staging prefix** (`staging/{org_id}/{build_id}.{ext}`), valid for **2 hours** (to accommodate the worst case: 500 MB on a 1 Mbps uplink takes ~67 minutes, plus retries). The presigned URL includes signed headers for `Content-Type` to prevent type confusion.

**Why staging prefix**: The presigned PUT URL is reusable until expiry. Using a staging prefix means the artifact is not yet "live" — `/complete` copies it to the final `artifacts/` key and deletes the staging object. This prevents mutation of finalized artifacts.

The CLI uploads the artifact directly:

```bash
curl -X PUT \
  -H "Content-Type: application/octet-stream" \
  --data-binary @MyApp.ipa "$UPLOAD_URL"
```

**Presigned URL contract:**

- Generated using R2's S3-compatible API via `@aws-sdk/s3-request-presigner` with R2 API credentials (access key ID + secret, configured as Worker secrets)
- Target key: `staging/{org_id}/{build_id}.{ext}` (staging prefix — promoted to `artifacts/` on `/complete`)
- Signed headers: `Content-Type`
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
4. **Copy** the staging object to the final key (`artifacts/{org_id}/{build_id}.{ext}`)
5. **Insert `builds` and `build_artifacts` rows in D1 atomically** (this is when the build record is created — see [data model](./04-data-model.md)). If the D1 insert fails, **delete the copied final object** (compensating rollback) and return `500`.
6. **Delete** the staging object (only after D1 commit succeeds — if this delete fails, staging cleanup happens via Cron, no data loss)
7. Delete the KV reservation (best-effort — TTL handles eventual cleanup)
8. Return the complete build record

Response `200 OK`: full build record (same shape as `GET /api/builds/:id`).

Response `409 Conflict`: if `/complete` has already been called for this build ID (idempotent guard — D1 row already exists).

If the CLI never calls `/complete` (crash, timeout), only an orphaned R2 staging object and an expiring KV entry remain — no dangling D1 rows. The daily Cron handler cleans up R2 objects under `staging/` older than 2 hours.

**Note**: The `sha256` is stored as **client-reported** — the server does not independently verify it against the R2 object content (streaming a 500 MB object through a Worker for hashing is impractical). Clients can verify integrity on download by comparing against the stored hash.

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

### POST /api/credentials — Upload Credential

```
POST /api/credentials
Authorization: Bearer bu_...
Content-Type: multipart/form-data

Form fields:
  file: <binary>                              (.p12, .mobileprovision, .p8, .jks, .json)
  platform: "ios" | "android"
  type: "distribution-certificate" | "provisioning-profile" | "push-key" | "keystore" | "play-service-account"
  name: "Production Distribution Cert"
  password: "p12-export-password"             (optional, for .p12 and .jks)
  keyAlias: "my-key-alias"                    (optional, for .jks)
  keyPassword: "key-password"                 (optional, for .jks)
  projectId: "uuid"                            (optional, scope to project)
  distribution: "app-store"                    (optional — required for provisioning profiles; null for certs/keystores/push-keys)
  metadata: '{"commonName":"...","teamId":"...","expiresAt":"..."}' (optional, CLI-supplied JSON)
  expiresAt: "2027-04-11T00:00:00.000Z"       (optional, CLI-extracted expiry)
```

Response `201 Created`:

```json
{
  "id": "cred_01HXYZ...",
  "platform": "ios",
  "type": "distribution-certificate",
  "distribution": null,
  "name": "Production Distribution Cert",
  "projectId": null,
  "isActive": false,
  "metadata": {
    "commonName": "Apple Distribution: Your Team (XXXXXXXXXX)",
    "serialNumber": "ABC123",
    "teamId": "XXXXXXXXXX",
    "expiresAt": "2027-04-11T00:00:00.000Z"
  },
  "expiresAt": "2027-04-11T00:00:00.000Z",
  "createdAt": "2026-04-11T12:00:00.000Z"
}
```

Server-side:

1. Store CLI-supplied metadata in `metadata_json` (server does not parse the binary blob in v1)
2. Generate random DEK, encrypt blob with DEK, encrypt DEK with org KEK
3. Store encrypted blob in R2 at `credentials/{org_id}/{credential_id}`
4. Store encrypted password alongside the blob (if provided)
5. Store metadata + encrypted DEK reference in D1

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

Returns metadata only — **never** returns credential blobs or passwords.

### POST /api/credentials/:id/activate — Set Active Credential

Sets a credential as the active one for its activation scope `(organization_id, project_id or org-wide, platform, type, distribution)`. Deactivates any previously active credential in the same scope within the same org.

```
POST /api/credentials/cred_01HXYZ.../activate
Authorization: Bearer bu_...
```

Response `200 OK`: updated credential metadata with `isActive: true`.

Response `404`: credential not found.

Server-side:

1. Verify caller has `credential:activate` permission
2. Deactivate any existing active credential in the same scope (set `is_active = 0`)
3. Set `is_active = 1` on the target credential
4. Return updated credential metadata

### GET /api/credentials/:id/download — Download Credential

Returns the decrypted credential as a JSON envelope. The CLI uses this to pull credentials before building.

Response `200 OK`:

```json
{
  "blob": "<base64-encoded raw file>",
  "password": "p12-export-password",
  "keyAlias": "my-key-alias",
  "keyPassword": "key-password",
  "filename": "dist.p12",
  "contentType": "application/x-pkcs12"
}
```

Only `blob` is always present. `password`, `keyAlias`, `keyPassword` are included when applicable (`.p12`, `.jks`). Returning secrets in the JSON body (over HTTPS) is safer than stuffing them into HTTP headers which may be logged by proxies.

Server-side:

1. Reject if auth is session/cookie (API key only)
2. Verify caller has `credential:download` permission
3. Fetch encrypted DEK + `key_version` from D1
4. Select master secret from keyring using `key_version`
5. Derive KEK using selected master secret
6. Decrypt DEK with KEK
7. Fetch encrypted blob from `BUILD_BUCKET` (private R2)
8. Decrypt blob with DEK
9. Decrypt password/keyAlias/keyPassword from D1
10. Return JSON envelope with `Cache-Control: no-store`

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

Returns **all values decrypted** as a flat JSON object. The CLI uses this to export before building.

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

| Endpoint                            | Limit | Window                 |
| ----------------------------------- | ----- | ---------------------- |
| `POST /api/builds` (upload)         | 30    | per hour per project   |
| `GET /api/builds` (list)            | 120   | per minute per project |
| `POST /api/credentials` (upload)    | 20    | per hour per org       |
| `GET /api/credentials/:id/download` | 30    | per minute per org     |
| `POST /api/env-vars`                | 100   | per hour per project   |

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
