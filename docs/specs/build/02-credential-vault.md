# 2. Credential Vault

## Overview

The credential vault stores iOS and Android signing credentials encrypted at rest on the better-update server. The CLI pulls credentials before each local build, writes them to temp files, uses them for signing, then cleans up.

Users upload credentials once — either interactively on first build (like EAS) or explicitly via CLI/dashboard. The vault replaces Expo's managed credentials.

## Credential Types

### iOS

| Credential               | File type             | Purpose                                       | Lifecycle                                |
| ------------------------ | --------------------- | --------------------------------------------- | ---------------------------------------- |
| Distribution Certificate | `.p12` (PKCS#12)      | Signs the app binary                          | 1 per Apple Developer team, valid 1 year |
| Provisioning Profile     | `.mobileprovision`    | Links cert + bundle ID + devices/entitlements | 1 per app per distribution method        |
| Push Notification Key    | `.p8` (APNs auth key) | Signs push notification requests              | Optional, does not expire                |

Distribution methods determine the profile type:

| Method        | Profile type | Use case                                        |
| ------------- | ------------ | ----------------------------------------------- |
| `development` | Development  | Debug builds on registered devices              |
| `ad-hoc`      | Ad Hoc       | Testing on specific devices (up to 100 UDIDs)   |
| `app-store`   | App Store    | TestFlight + App Store submission               |
| `enterprise`  | Enterprise   | In-house distribution (Enterprise account only) |

### Android

| Credential                  | File type             | Purpose                      | Lifecycle                 |
| --------------------------- | --------------------- | ---------------------------- | ------------------------- |
| Upload Keystore             | `.jks` or `.keystore` | Signs the AAB/APK for upload | 1 per app, user-generated |
| Google Play Service Account | `.json`               | Automated Play Store upload  | Optional                  |

With Play App Signing enabled (recommended), Google manages the actual signing key. The upload keystore signs the upload only — if lost, Google can reset it.

## Interactive Provisioning (First Build)

When `better-update build` runs and no credentials exist for the project+platform+distribution combo, the CLI prompts interactively — same UX as `eas build` on first run.

### iOS Flow

```
$ better-update build --platform ios --profile production

  No iOS distribution certificate found for this project.

  ? Select distribution certificate (.p12):
    > /path/to/dist.p12

  ? Certificate password:
    > ••••••••

  ✓ Certificate uploaded: "Apple Distribution: Your Team (XXXXXXXXXX)"
    Expires: 2027-04-11

  ? Select provisioning profile (.mobileprovision):
    > /path/to/AppStore.mobileprovision

  ✓ Profile uploaded: "MyApp AppStore"
    Bundle ID: com.example.app
    Type: app-store

  Building...
```

### Android Flow

```
$ better-update build --platform android --profile production

  No Android keystore found for this project.

  ? How would you like to provide credentials?
    ❯ Select keystore from disk
      Generate new keystore

  ? Select keystore (.jks or .keystore):
    > /path/to/release.jks

  ? Keystore password:
    > ••••••••

  ? Key alias:
    > my-key-alias

  ? Key password:
    > ••••••••

  ✓ Keystore uploaded: alias "my-key-alias"

  Building...
```

### Generate New Keystore

If user selects "Generate new keystore", the CLI generates one locally:

```bash
keytool -genkey -v \
  -keystore release.keystore \
  -alias <prompted> \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass <prompted> -keypass <prompted> \
  -dname "CN=<prompted>, O=<prompted>"
```

Then uploads to the vault automatically.

## Encryption Model

```
User uploads .p12 file via CLI/Dashboard
    │
    ▼
Server generates per-credential AES-256-GCM key (DEK)
    │
    ├── Encrypts credential blob with DEK
    ├── Encrypts DEK with org-level master key (KEK)
    │   KEK = HKDF-SHA256(VAULT_SECRET, org_id, key_version, "credential-vault")
    │
    ├── Stores encrypted blob in BUILD_BUCKET: credentials/{org_id}/{credential_id}
    └── Stores encrypted DEK + key_version + metadata in D1: credentials table
```

### Key Hierarchy

```
VAULT_SECRET (dedicated Worker secret, separate from BETTER_AUTH_SECRET)
    └── KEK per org = HKDF(VAULT_SECRET, org_id, key_version, "credential-vault")
         └── DEK per credential = random AES-256-GCM key
              └── Encrypts the actual .p12 / .jks / .mobileprovision blob
```

**Why a dedicated `VAULT_SECRET`**: `BETTER_AUTH_SECRET` is used for session signing and auth flows. Rotating it would require re-encrypting all vault data. A dedicated `VAULT_SECRET` isolates vault encryption from auth concerns — each can be rotated independently.

### Key Rotation — Versioned Keyring

Each credential stores the `key_version` (integer) used to derive the KEK that encrypted its DEK. The server maintains a **keyring** of master secrets to support rolling rotation:

```
VAULT_SECRET_V1  →  KEK for key_version=1
VAULT_SECRET_V2  →  KEK for key_version=2  (current)
```

**Rotation procedure:**

1. Add the new secret as `VAULT_SECRET_V<N>` (e.g., via Wrangler secrets). Keep all previous versions in the keyring.
2. Set the global `CURRENT_KEY_VERSION` to `N`. New credentials use version `N`.
3. Existing credentials remain readable: the server reads `key_version` from the credential record, selects the corresponding master secret from the keyring, and derives the correct KEK.
4. A background migration re-encrypts DEKs with the latest KEK at leisure (not time-critical).
5. Once all credentials are re-encrypted to version `N`, retire version `N-1` from the keyring.

**Implementation**: Store the keyring as a JSON Wrangler secret (`VAULT_KEYRING = {"1":"<base64>","2":"<base64>"}`), or as individual secrets (`VAULT_SECRET_V1`, `VAULT_SECRET_V2`) resolved at startup. The current version is stored in a D1 config row or derived from the highest key in the keyring.

This avoids a "big bang" migration event when rotating secrets and ensures old credentials remain decryptable throughout the transition.

### Encryption Details

| Parameter      | Value                                                          |
| -------------- | -------------------------------------------------------------- |
| Algorithm      | AES-256-GCM                                                    |
| IV             | 12 bytes, random per encryption                                |
| Auth tag       | 16 bytes, appended to ciphertext                               |
| DEK size       | 32 bytes                                                       |
| KEK derivation | HKDF-SHA256 with (VAULT_SECRET, org_id, key_version) as inputs |
| Storage format | `iv (12B) \|\| ciphertext \|\| tag (16B)`                      |
| Key version    | Integer, stored per credential in D1                           |

All cryptographic operations use the Web Crypto API available in Cloudflare Workers.

## Credential Selection

When the CLI requests credentials for a build, the server selects by:

1. **Project-scoped credentials** — if a credential is linked to the project, prefer it
2. **Org-wide credentials** — fall back to credentials without a `projectId`
3. **Type matching** — select the correct type for the build's distribution method (e.g., `app-store` profile for production, `ad-hoc` for preview)
4. **Bundle ID matching** (iOS profiles) — the provisioning profile's bundle ID must match the project's `ios.bundleIdentifier`
5. **Team ID matching** (iOS) — the distribution certificate's team ID must match the provisioning profile's team ID
6. **Expiry check** — warn if credential expires within 30 days (yellow warning). If already expired, the CLI warns prominently and prompts for confirmation before proceeding — the build may succeed for local testing but will fail App Store/Play Store submission. The server does not block downloads of expired credentials.

If multiple credentials match the same type+platform+distribution, the most recently uploaded one is selected by default. Users can override this by setting a credential as **active** for a project via `better-update credentials activate <id>` or the dashboard — the active credential always takes precedence over `createdAt` ordering. This avoids race conditions during concurrent uploads or credential replacement.

If no match is found, the CLI prompts interactively (first-build flow).

## Credential Pull (CLI → Build)

Before each build, the CLI:

```
1. Create a unique per-build temp directory:
   BUILD_DIR=$(mktemp -d "$TMPDIR/better-update-XXXXXXXX")
   chmod 0700 "$BUILD_DIR"

2. GET /api/credentials?projectId=X&platform=ios&type=distribution-certificate
      (no distribution filter — certs are not distribution-specific)
3. GET /api/credentials?projectId=X&platform=ios&type=provisioning-profile&distribution=app-store
      (distribution filter required — profiles are distribution-specific)
4. GET /api/credentials/:id/download  (returns JSON envelope with decrypted blob + secrets)

5. Write to temp files (inside unique BUILD_DIR):
   - $BUILD_DIR/cert.p12
   - $BUILD_DIR/profile.mobileprovision

6. Setup code signing:
   - iOS: create ephemeral keychain named "better-update-<random>" (not reusing a fixed name)
   - Android: export env vars from JSON envelope

7. Register cleanup trap (SIGINT, SIGTERM, EXIT):
   - Delete $BUILD_DIR and all contents
   - Delete ephemeral keychain (iOS)

8. Run build

9. Cleanup (trap fires): temp files + keychain deleted
```

**Crash recovery**: On next startup, the CLI sweeps `$TMPDIR/better-update-*` directories older than 1 hour and deletes them. This handles cases where the cleanup trap did not fire (e.g., `kill -9`).

The download endpoint (`GET /api/credentials/:id/download`) returns a JSON envelope with the decrypted blob and associated secrets (see [API spec](./05-api-endpoints.md)). It requires **API key auth only** (`Authorization: Bearer bu_...`) — session/cookie auth is explicitly rejected to prevent browser-side exfiltration of signing material. The response includes `Cache-Control: no-store` to prevent caching.

## Dashboard UI

The credential vault page shows:

- List of credentials per platform with metadata (name, type, expiry, linked project)
- Expiry warnings (yellow at 30 days, red at 7 days)
- Upload dialog (drag & drop or file picker)
- Delete with confirmation
- Project scope assignment (org-wide or specific project)

## Security Considerations

| Concern                  | Mitigation                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Credential at rest       | AES-256-GCM envelope encryption, decrypted only in Worker memory                   |
| Credential in transit    | HTTPS (TLS 1.3) between CLI and Worker                                             |
| Credential on local disk | Written to `$TMPDIR`, deleted after build, ephemeral                               |
| iOS keychain             | Ephemeral keychain created per build, deleted after                                |
| Dashboard exposure       | Dashboard never sees raw credentials — only metadata                               |
| R2 direct access         | `BUILD_BUCKET` is private (no public access), separate from public `ASSETS_BUCKET` |
| Secret rotation          | `key_version` per credential allows rolling rotation without downtime              |
