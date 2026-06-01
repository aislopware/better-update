# EAS Update Protocol Specification

Reference specification for building a self-hosted OTA update server compatible with Expo's `expo-updates` client.

---

## Table of Contents

- [1. Architecture Overview](#1-architecture-overview)
- [2. Protocol v1 Specification](#2-protocol-v1-specification)
- [3. Manifest Format](#3-manifest-format)
- [4. Multipart Response](#4-multipart-response)
- [5. Extensions](#5-extensions)
- [6. Directives](#6-directives)
- [7. Asset Serving](#7-asset-serving)
- [8. Code Signing](#8-code-signing)
- [9. Rollbacks](#9-rollbacks)
- [10. Branches & Channels](#10-branches--channels)
- [11. Runtime Version & Platform Matching](#11-runtime-version--platform-matching)
- [12. Fingerprint](#12-fingerprint)
- [13. Client-Side Behavior](#13-client-side-behavior)
- [14. Configuration Reference](#14-configuration-reference)
- [15. Request/Response Flow](#15-requestresponse-flow)

---

## 1. Architecture Overview

### Two-Layer Model

Every Expo app binary consists of two layers:

```text
+-----------------------------+
|       Update Layer          |  <-- Swappable OTA (JS bundle + assets)
+-----------------------------+
|       Native Layer          |  <-- Fixed at build time (requires store release)
+-----------------------------+
```

**Native layer** (fixed at build time):

- Native modules, SDKs, and custom native code
- `expo-updates` client library itself
- Build-time configuration (runtime version, channel, code signing certificate)
- Requires a new App Store / Play Store submission to change

**Update layer** (swappable OTA):

- JavaScript bundle (application logic, React components)
- Static assets (images, fonts, audio, etc.)
- Can be swapped without a new store submission

### What Can Be Updated OTA

| Can Update                          | Cannot Update                                    |
| ----------------------------------- | ------------------------------------------------ |
| JS/TS application code              | Native module code (Swift/Kotlin/C++)            |
| React components & navigation       | Native dependencies (CocoaPods/Gradle)           |
| Static images, fonts, audio         | App binary metadata (icons, splash, permissions) |
| Configuration accessible at runtime | Build-time native configuration                  |

### System Components

```text
+----------+     manifest request      +------------------+
|          | ------------------------> |                  |
|  Client  | <------------------------ |  Update Server   |
|  (App)   |     manifest + directive  |                  |
|          |                           +------------------+
|          |     asset request         +------------------+
|          | ------------------------> |                  |
|          | <------------------------ |  Asset CDN       |
|          |     asset binary          |                  |
+----------+                           +------------------+
```

- **Update Server**: Responds to manifest requests with update metadata. Resolves which update to serve based on platform, runtime version, and channel.
- **Asset CDN**: Hosts the actual JS bundles and static assets. Assets are content-addressed and immutable.
- **Client**: The `expo-updates` native module embedded in the app binary. Manages the check/download/launch lifecycle.

### EAS Update Endpoints

| Endpoint                          | Purpose         |
| --------------------------------- | --------------- |
| `https://u.expo.dev/{project-id}` | Manifest server |
| `https://assets.eascdn.net`       | Asset CDN       |

For self-hosted servers, both endpoints are developer-defined.

---

## 2. Protocol v1 Specification

### Expo Structured Field Values (SFV)

The protocol uses a subset of [RFC 8941](https://www.rfc-editor.org/rfc/rfc8941) Structured Field Values, versioned as SFV v0.

**Supported types:** Dictionaries, Strings, Integers, Decimals, Booleans, Tokens.

**Not supported:** Lists, Inner Lists, Byte Sequences, Parameters.

A bare key (no `=value`) is treated as boolean true. This is used by the `sig` key in `expo-expect-signature`.

Example: `sig, keyid="root", alg="rsa-v1_5-sha256"` — here `sig` is a bare boolean true item.

### Manifest Request

**Method:** `GET`

**Required Headers:**

| Header                  | Type    | Description                                                           |
| ----------------------- | ------- | --------------------------------------------------------------------- |
| `expo-protocol-version` | Integer | Must be `1`                                                           |
| `expo-platform`         | String  | `ios` or `android`. Other values: server SHOULD return `400` or `404` |
| `expo-runtime-version`  | String  | Runtime version string set at build time                              |

**Recommended Headers:**

| Header                  | Type     | Description                                                                                            |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `accept`                | String   | `multipart/mixed, application/expo+json;q=0.9, application/json;q=0.8`                                 |
| `expo-channel-name`     | String   | Channel name (EAS convention, not protocol-v1 requirement). Sent via `requestHeaders` in native config |
| `expo-expect-signature` | Expo SFV | Code signing expectation: `sig, keyid="main", alg="rsa-v1_5-sha256"`                                   |
| `expo-extra-params`     | Expo SFV | Extra parameters set via `setExtraParamAsync()`. Sent as an SFV dictionary                             |

**Conditional Headers:**

Any headers previously received via `expo-server-defined-headers` MUST be re-sent on subsequent requests.

### Manifest Response

**Required Headers (on `200` responses):**

| Header                  | Type    | Description                                                       |
| ----------------------- | ------- | ----------------------------------------------------------------- |
| `expo-protocol-version` | Integer | Must be `1`                                                       |
| `expo-sfv-version`      | Integer | Must be `0`                                                       |
| `content-type`          | String  | `multipart/mixed`, `application/expo+json`, or `application/json` |

**Optional Headers:**

| Header                        | Type     | Description                                                                                                                      |
| ----------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `expo-manifest-filters`       | Expo SFV | Filters to apply to stored updates by `metadata` field                                                                           |
| `expo-server-defined-headers` | Expo SFV | Headers the client MUST store and re-send on future requests                                                                     |
| `expo-signature`              | Expo SFV | Signature for non-multipart responses (`application/json`, `application/expo+json`). In `multipart/mixed`, this is a part header |
| `cache-control`               | String   | Recommended: `private, max-age=0`. MUST be short duration                                                                        |

### Error Responses

| Status        | Condition                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `200`         | Success (manifest, directive, or both)                                                                            |
| `204`         | No update or directive available. No body or `content-type`. Common headers SHOULD still be sent and processed    |
| `400` / `404` | Unknown or unsupported `expo-platform` value                                                                      |
| `406`         | Unsupported response format, protocol version mismatch, or directive needed but client only accepts non-multipart |

> **`204` note:** Even on empty responses, the server SHOULD send `expo-protocol-version`, `expo-sfv-version`, `expo-manifest-filters`, and `expo-server-defined-headers`. The client MUST process these headers regardless of status code.

### Content Type Behavior

| Content-Type            | Supports Manifest | Supports Directive | Notes                        |
| ----------------------- | ----------------- | ------------------ | ---------------------------- |
| `multipart/mixed`       | Yes               | Yes                | Full protocol support        |
| `application/expo+json` | Yes               | No                 | Manifest only, no directives |
| `application/json`      | Yes               | No                 | Manifest only, no directives |

Server SHOULD return `406` if a directive (e.g., rollback) is needed but the client only accepts non-multipart formats.

---

## 3. Manifest Format

### Structure

```typescript
type ExpoUpdatesManifest = {
  id: string; // UUID, uniquely identifies this update
  createdAt: string; // ISO 8601 datetime, used for ordering
  runtimeVersion: string; // Compatibility string matching the native build
  launchAsset: Asset; // Entry point (JS bundle)
  assets: Asset[]; // All other assets for this update
  metadata: Record<string, string>; // Must pass expo-manifest-filters
  extra?: ManifestExtra; // Optional per SDK types; protocol spec shows it in examples
};
```

### Asset

```typescript
type Asset = {
  key: string; // Reference key used by application code
  url: string; // Fetch URL; MUST NOT change or be removed after publication
  contentType: string; // MIME type (RFC 2045), e.g., "application/javascript"
  fileExtension?: string; // Prefixed with ".", e.g., ".png". Ignored for launchAsset
  hash?: string; // Base64URL-encoded SHA-256 hash (RFC 4648 section 5)
};
```

### ManifestExtra

```typescript
type ManifestExtra = {
  scopeKey?: string; // Opaque string for client-side data scoping
  expoClient?: ExpoClientConfig;
  eas?: EASConfig;
  expoGo?: ExpoGoConfig; // Dev mode only
};

type ExpoClientConfig = Record<string, unknown> & {
  hostUri?: string; // Dev server host URI
  // Extends Expo app config with additional fields injected at publish time
};

type EASConfig = {
  projectId?: string; // UUID, stable across renames/transfers
};

type ExpoGoConfig = {
  debuggerHost?: string;
  developer?: { tool?: string };
  mainModuleName?: string;
  packagerOpts?: Record<string, unknown>;
}; // Dev-only metadata consumed by Expo Go
```

### Metadata & Filtering

The `metadata` field is a flat `Record<string, string>` dictionary. The server sends `expo-manifest-filters` as an Expo SFV dictionary in the response header.

**Filter rules:**

- For each key in the filter, the corresponding manifest `metadata` field must be either **absent** or **equal** to the filter value.
- The client MUST store filters persistently until overwritten by a newer response.
- Stored updates that fail the filter are discarded.

### Manifest Ordering

Updates are ordered by `createdAt` (ISO 8601). The most recently created update for a given platform + runtime version combination is the active update.

### Embedded Manifest

```typescript
type EmbeddedManifest = {
  id: string;
  commitTime: number; // Unix timestamp
  assets: any[]; // Intentionally underspecified
};
```

The embedded manifest represents the update baked into the app binary at build time.

---

## 4. Multipart Response

Content-Type: `multipart/mixed` ([RFC 2046 section 5.1](https://www.rfc-editor.org/rfc/rfc2046#section-5.1))

Part order is NOT significant. Zero parts = no-op (server MAY return `204` instead).

### Part: `manifest`

| Part Header           | Value                                           |
| --------------------- | ----------------------------------------------- |
| `content-disposition` | `name="manifest"` (token before `name=` varies) |
| `content-type`        | `application/json` or `application/expo+json`   |
| `expo-signature`      | Present if code signing is active               |

Body: Manifest JSON. The client MUST match on `name="manifest"`, not on the disposition token (e.g., `form-data`, `inline`).

### Part: `extensions`

| Part Header           | Value                              |
| --------------------- | ---------------------------------- |
| `content-disposition` | `name="extensions"` (token varies) |
| `content-type`        | `application/json`                 |

Body: Extensions JSON (see [Extensions](#5-extensions)).

### Part: `directive`

| Part Header           | Value                                         |
| --------------------- | --------------------------------------------- |
| `content-disposition` | `name="directive"` (token varies)             |
| `content-type`        | `application/json` or `application/expo+json` |
| `expo-signature`      | Present if code signing is active             |

Body: Directive JSON (see [Directives](#6-directives)).

### Example Multipart Response

```http
HTTP/1.1 200 OK
expo-protocol-version: 1
expo-sfv-version: 0
cache-control: private, max-age=0
content-type: multipart/mixed; boundary=BOUNDARY

--BOUNDARY
content-disposition: form-data; name="manifest"
content-type: application/expo+json

{
  "id": "0754f1c0-e267-4a5b-80c0-47bc6f65c2b6",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "runtimeVersion": "1.0.0",
  "launchAsset": {
    "key": "bundle",
    "url": "https://assets.example.com/bundles/abc123.js",
    "contentType": "application/javascript",
    "hash": "dGhlIGhhc2g"
  },
  "assets": [
    {
      "key": "logo",
      "url": "https://assets.example.com/assets/logo.png",
      "contentType": "image/png",
      "fileExtension": ".png",
      "hash": "bG9nbyBoYXNo"
    }
  ],
  "metadata": {},
  "extra": {
    "scopeKey": "@user/my-app",
    "eas": { "projectId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" }
  }
}
--BOUNDARY
content-disposition: form-data; name="extensions"
content-type: application/json

{
  "assetRequestHeaders": {
    "logo": {
      "authorization": "Bearer token123"
    }
  }
}
--BOUNDARY--
```

---

## 5. Extensions

Extensions provide per-asset request metadata that the client must use when fetching assets. The `Extensions` type is forward-extensible — servers MAY include additional top-level keys beyond `assetRequestHeaders`, and clients SHOULD ignore unrecognized keys.

```typescript
type Extensions = {
  assetRequestHeaders: {
    [assetKey: string]: {
      [headerName: string]: string;
    };
  };
  [key: string]: unknown; // Forward-extensible
};
```

The client MUST include the specified headers when fetching the corresponding asset by its `key`.

---

## 6. Directives

Directives are server instructions to the client that are not updates themselves. The protocol allows custom directive types — `rollBackToEmbedded` is the only one currently defined by Expo/EAS, but servers MAY define additional types. Clients SHOULD ignore unrecognized directive types.

```typescript
type Directive = {
  type: string;
  parameters?: Record<string, any>;
  extra?: Record<string, any>;
};
```

### `rollBackToEmbedded`

The only directive type currently defined by Expo/EAS. Instructs the client to use the update embedded in the app binary.

```json
{
  "type": "rollBackToEmbedded",
  "parameters": {
    "commitTime": "2024-01-15T10:30:00.000Z"
  }
}
```

> **Note:** The `parameters.commitTime` field is observed in practice but is not formally specified in Expo's public protocol documentation.

Directives require `multipart/mixed` responses. They cannot be sent via `application/json` or `application/expo+json` responses.

Directives support code signing: the `expo-signature` header on the directive part is verified the same way as manifest signatures.

---

## 7. Asset Serving

### Asset Request

```http
GET /assets/abc123.js HTTP/1.1
accept: application/javascript, */*
accept-encoding: br, gzip
authorization: Bearer token123          ← from extensions.assetRequestHeaders
```

The client sends:

- Standard `accept` and `accept-encoding` headers
- Any additional headers specified in `extensions.assetRequestHeaders` for this asset's `key`

### Asset Response

```http
HTTP/1.1 200 OK
content-type: application/javascript
content-encoding: br
cache-control: public, max-age=31536000, immutable
```

### Integrity Verification

When the manifest `hash` field is present, the client MUST verify the downloaded asset:

1. Decompress the asset (if compressed)
2. Compute SHA-256 hash of the raw bytes
3. Encode as base64url (RFC 4648 section 5, no padding)
4. Compare with the `hash` field in the manifest

If `hash` is absent, integrity verification is skipped.

If verification fails, the asset MUST be rejected.

### Immutability Guarantee

Asset URLs MUST NOT change or be removed after publication. Assets are content-addressed and immutable.

### Compression

Servers SHOULD support both Gzip and Brotli compression. EAS Update uses Brotli as the preferred encoding.

### Asset Deduplication

The client only downloads assets not already cached from prior updates. Assets embedded in the app binary that match the manifest are not re-fetched.

### `assetPatternsToBeBundled`

Controls which assets are included in OTA update bundles vs. embedded in the native binary.

SDK 52+:

```json
{
  "updates": {
    "assetPatternsToBeBundled": ["app/images/**/*.png"]
  }
}
```

SDK < 52:

```json
{
  "extra": {
    "updates": {
      "assetPatternsToBeBundled": ["app/images/**/*.png"]
    }
  }
}
```

Assets NOT matching these patterns are excluded from OTA updates. Assets still needed at runtime must be present in the native build. Verify with:

```sh
npx expo-updates assets:verify
```

---

## 8. Code Signing

### Overview

Code signing ensures updates originate from a trusted source. The private key never leaves the developer's machine -- signing happens locally before upload.

```text
Developer Machine                    Update Server              Client
+--------------+                   +--------------+          +----------+
| Private Key  |--sign manifest--> |  Manifest +  |--send--> | Embedded |
|              |                   |  Signature   |          | Cert     |
+--------------+                   +--------------+          | verifies |
                                                             +----------+
```

### Key Generation

```sh
npx expo-updates codesigning:generate \
  --key-output-directory keys \
  --certificate-output-directory certs \
  --certificate-validity-duration-years 10 \
  --certificate-common-name "Your Organization Name"
```

Produces:

- `keys/private-key.pem` -- RSA private key (keep secret)
- `keys/public-key.pem` -- RSA public key
- `certs/certificate.pem` -- PEM certificate (embed in builds)

Algorithm: `rsa-v1_5-sha256`

### Configuration

**app.json:**

```json
{
  "expo": {
    "updates": {
      "codeSigningCertificate": "./certs/certificate.pem",
      "codeSigningMetadata": {
        "keyid": "main",
        "alg": "rsa-v1_5-sha256"
      }
    }
  }
}
```

**iOS (Expo.plist):**

```xml
<key>EXUpdatesCodeSigningCertificate</key>
<string><!-- XML-escaped PEM cert (\r -> &#xD;) --></string>
<key>EXUpdatesCodeSigningMetadata</key>
<dict>
  <key>keyid</key><string>main</string>
  <key>alg</key><string>rsa-v1_5-sha256</string>
</dict>
```

**Android (AndroidManifest.xml):**

```xml
<meta-data
  android:name="expo.modules.updates.CODE_SIGNING_CERTIFICATE"
  android:value="(XML-escaped cert, \r -> &#xD; \n -> &#xA;)"/>
<meta-data
  android:name="expo.modules.updates.CODE_SIGNING_METADATA"
  android:value='{"keyid":"main","alg":"rsa-v1_5-sha256"}'/>
```

### Publishing Signed Updates

```sh
eas update --private-key-path keys/private-key.pem
```

### Request/Response Headers

Client sends:

```http
expo-expect-signature: sig, keyid="main", alg="rsa-v1_5-sha256"
```

Server responds with `expo-signature`:

- **Non-multipart responses** (`application/json`, `application/expo+json`): `expo-signature` is a top-level HTTP response header.
- **Multipart responses** (`multipart/mixed`): `expo-signature` is a part header on the `manifest` and `directive` parts individually.

```http
expo-signature: sig="<base64-encoded-signature>", keyid="main", alg="rsa-v1_5-sha256"
```

### Verification Chain

1. Client extracts `expo-signature` — from the response header (non-multipart) or the part header (multipart)
2. Client parses the signature value from the `sig` field
3. Client verifies the signature against the manifest/directive body using the embedded certificate
4. For certificate chains, the client validates the chain up to a trusted root certificate
5. If verification fails, the update MUST be rejected

### Certificate Rotation

1. Back up old keys and certificate
2. Generate new key pair and certificate (optionally change `keyid`)
3. **Bump the runtime version** (the certificate is part of the native runtime)
4. Publish new signed updates with the new key
5. Submit a new app binary with the new certificate embedded

To remove code signing entirely: remove `codeSigningMetadata` from config and bump runtime version (treated as rotation to a null key).

### Security Notes

- Private key never leaves the developer's machine
- Shorter certificate validity limits exposure from key compromise
- Binaries with expired certificates will not apply new updates
- Convention: 20-year cert for broad distribution, 1-year for internal apps

---

## 9. Rollbacks

### Two Mechanisms

| Mechanism                       | How It Works                                                         | Use Case                                        |
| ------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| **Rollback to previous update** | Re-publish a previously-published JS bundle as a new update          | Revert a bad JS change                          |
| **Rollback to embedded**        | Send `rollBackToEmbedded` directive; clients use the embedded update | Revert to the update embedded in the app binary |

### Rollback Directive

```json
{
  "type": "rollBackToEmbedded",
  "parameters": {
    "commitTime": "2024-01-15T10:30:00.000Z"
  }
}
```

The directive is sent as a multipart part (see [Directives](#6-directives)).

### CLI Command

```sh
eas update:rollback
```

Interactive guide for selecting rollback type and target.

### Client-Side Processing

When `checkForUpdateAsync()` receives a rollback directive:

```typescript
// Check result
type UpdateCheckResultRollBack = {
  isAvailable: false;
  isRollBackToEmbedded: true;
  manifest: undefined;
  reason: undefined;
};

// Fetch result
type UpdateFetchResultRollBackToEmbedded = {
  isNew: false;
  isRollBackToEmbedded: true;
  manifest: undefined;
};
```

### Rollback Rejection Reasons

| Reason                                  | Description                                             |
| --------------------------------------- | ------------------------------------------------------- |
| `ROLLBACK_REJECTED_BY_SELECTION_POLICY` | Directive does not pass the client's selection policy   |
| `ROLLBACK_NO_EMBEDDED`                  | App has no embedded update (`useEmbeddedUpdate: false`) |

### Anti-Bricking Measures

The client includes anti-bricking protections to prevent updates from rendering the app permanently unusable:

- **Emergency launch**: If the update system itself fails critically, the app launches with the embedded update and sets `isEmergencyLaunch: true`
- **Error recovery**: Fatal JS errors within 10 seconds of first render trigger automatic recovery (see [Client-Side Behavior](#13-client-side-behavior))
- **Configuration**: `updates.disableAntiBrickingMeasures` (default `false`) can disable these protections (not recommended)

Publishing a new update after any rollback causes all clients to receive the new update on next check.

---

## 10. Branches & Channels

### Concepts

**Branch**: A named sequence of updates. Each branch contains an ordered list of updates; the most recent compatible update is the active one.

**Channel**: A named identifier embedded in the app binary at build time. Channels are mapped to branches.

```text
Build (channel: "production") --maps to--> Branch "production" --> Latest Update
```

### Channel-to-Branch Mapping

By default, a channel auto-links to a branch of the same name. This mapping can be changed:

```sh
# Relink a channel to a different branch
eas channel:edit production --branch version-2.0
```

### Update Resolution Flow

```text
Client Request
  |
  +-- expo-channel-name: "production"
  +-- expo-platform: "ios"
  +-- expo-runtime-version: "1.0.0"
        |
        v
Channel "production"
        | (mapped to)
        v
Branch "production"
        | (filter by)
        +-- platform = ios
        +-- runtimeVersion = 1.0.0
        |
        v
Most recent matching update (by createdAt)
```

### Publishing

```sh
eas update --branch production --message "Fix login bug"
```

### Channel Configuration

**eas.json** (for EAS Build):

```json
{
  "build": {
    "preview": {
      "channel": "preview"
    },
    "production": {
      "channel": "production"
    }
  }
}
```

**app.json** (for non-EAS builds):

```json
{
  "expo": {
    "updates": {
      "requestHeaders": {
        "expo-channel-name": "production"
      }
    }
  }
}
```

### Deployment Patterns

#### Simple (Two-Command)

Single channel and branch named `production`. Publish directly.

```sh
eas update --branch production
```

#### Persistent Staging

Separate `staging` and `production` channels/branches. Test on staging, then re-publish to production.

```sh
eas update --branch staging
# After testing:
eas update --branch production
```

#### Platform-Specific

Separate branches per platform when platform-specific fixes are needed.

| Channel              | Branch               |
| -------------------- | -------------------- |
| `ios-staging`        | `ios-staging`        |
| `ios-production`     | `ios-production`     |
| `android-staging`    | `android-staging`    |
| `android-production` | `android-production` |

#### Branch Promotion

Use branch relinking to promote tested updates.

```sh
# Create versioned branch
eas update --branch version-2.0

# Test via staging channel
eas channel:edit staging --branch version-2.0

# Promote to production
eas channel:edit production --branch version-2.0
```

---

## 11. Runtime Version & Platform Matching

### Runtime Version

A developer-defined string that guarantees compatibility between a build's native code and an OTA update. If the runtime version doesn't match exactly, the update is not applied.

### Runtime Version Configuration

**Manual string:**

```json
{ "expo": { "runtimeVersion": "1.0.0" } }
```

**Policy-based:**

```json
{ "expo": { "runtimeVersion": { "policy": "appVersion" } } }
```

**Platform-specific override:**

```json
{
  "expo": {
    "runtimeVersion": "1.0.0",
    "android": { "runtimeVersion": "1.0.1" },
    "ios": { "runtimeVersion": "1.0.0" }
  }
}
```

### Policies

| Policy          | Behavior                                                                               | Example Output  |
| --------------- | -------------------------------------------------------------------------------------- | --------------- |
| `appVersion`    | Uses `expo.version`                                                                    | `"2.1.0"`       |
| `nativeVersion` | Combines `version` + platform build number (`ios.buildNumber` / `android.versionCode`) | `"2.1.0(3)"`    |
| `fingerprint`   | Hash of project native footprint via `@expo/fingerprint`                               | `"a1b2c3d4..."` |

`nativeVersion` can diverge per platform since iOS and Android use different build number fields. `fingerprint` is recommended when you want runtime version to automatically track native-affecting changes.

A literal string value (e.g., `"runtimeVersion": "1.0.0"`) is not a policy — it is a manually managed version that must be bumped by the developer when native code changes.

### Platform Matching

The client sends `expo-platform` (`ios` or `android`). The server MUST only return updates matching that platform. Manifest resolution is platform-specific, though `eas update` publishes for all platforms by default (creating an update group with per-platform entries).

### Matching Rules

An update is compatible with a client if ALL of the following are true:

1. `expo-platform` matches the update's target platform
2. `expo-runtime-version` matches the update's `runtimeVersion` exactly (string equality)
3. The channel is mapped to the branch containing the update
4. The update passes `expo-manifest-filters`

---

## 12. Fingerprint

`@expo/fingerprint` generates a deterministic hash of the project's native footprint, used as an automatic runtime version.

### Hash Algorithm

Default: SHA-1 via `crypto.createHash()`. Configurable via `hashAlgorithm` option.

### Fingerprint Structure

```typescript
interface Fingerprint {
  hash: string;
  sources: FingerprintSource[];
}

type FingerprintSource = HashSource & {
  hash: string | null;
  debugInfo?: DebugInfo;
};

// Source types
type HashSourceFile = { filePath: string; reasons: string[]; type: "file" };
type HashSourceDir = { filePath: string; reasons: string[]; type: "dir" };
type HashSourceContents = {
  contents: string | Buffer;
  id: string;
  reasons: string[];
  type: "contents";
};
```

### API

```typescript
createFingerprintAsync(projectRoot, options?): Promise<Fingerprint>
createProjectHashAsync(projectRoot, options?): Promise<string>
diffFingerprintChangesAsync(fingerprint, projectRoot): Promise<FingerprintDiff>
diffFingerprints(f1, f2): Promise<FingerprintDiff>  // requires sorted sources
```

### SourceSkips Bitmask

Controls what is excluded from fingerprint calculation:

| Name                                             | Value  | Description                                     |
| ------------------------------------------------ | ------ | ----------------------------------------------- |
| `None`                                           | `0`    | Include everything                              |
| `ExpoConfigVersions`                             | `1`    | Skip `version` and `buildNumber`                |
| `ExpoConfigRuntimeVersionIfString`               | `2`    | Skip string `runtimeVersion`                    |
| `ExpoConfigNames`                                | `4`    | Skip `name` and `slug`                          |
| `ExpoConfigAndroidPackage`                       | `8`    | Skip `android.package`                          |
| `ExpoConfigIosBundleIdentifier`                  | `16`   | Skip `ios.bundleIdentifier`                     |
| `ExpoConfigSchemes`                              | `32`   | Skip URL schemes                                |
| `ExpoConfigEASProject`                           | `64`   | Skip EAS project config                         |
| `ExpoConfigAssets`                               | `128`  | Skip asset-related config                       |
| `ExpoConfigAll`                                  | `256`  | Skip entire Expo config                         |
| `PackageJsonAndroidAndIosScriptsIfNotContainRun` | `512`  | Skip platform scripts unless they contain `run` |
| `PackageJsonScriptsAll`                          | `1024` | Skip all package.json scripts                   |
| `GitIgnore`                                      | `2048` | Skip .gitignore processing                      |
| `ExpoConfigExtraSection`                         | `4096` | Skip `extra` section                            |

### `.fingerprintignore`

File-level exclusions (uses `minimatch` syntax, not gitignore syntax). Also available via `ignorePaths` API option.

Default directory exclusions: `android/build`, `android/app/build`, `android/app/.cxx`, `ios/Pods`

---

## 13. Client-Side Behavior

### Update Lifecycle

```text
App Launch
    |
    v
+----------------------+
| Load cached/embedded |
| update immediately   |
+----------+-----------+
           |
           v
+---------------------+     +----------------------+
| Check for update    |---->| Download new update  |
| (background)        |     | (background)         |
+---------------------+     +----------+-----------+
                                        |
                                        v
                             +----------------------+
                             | Available on next    |
                             | app launch           |
                             +----------------------+
```

### Launch Behavior

1. **Phase 1**: Download manifest
2. **Phase 2**: Download only new/changed assets (deduplication against cache)
3. If both phases complete before `fallbackToCacheTimeout` → new update runs immediately
4. If timeout exceeded → download continues in background, update runs on next launch
5. Fallback order: newest downloaded update → embedded update

### `checkAutomatically` Modes

| Value               | Behavior                                 |
| ------------------- | ---------------------------------------- |
| `ON_LOAD`           | Check every time app is loaded (default) |
| `ON_ERROR_RECOVERY` | Only check after error recovery          |
| `WIFI_ONLY`         | Only check when connected to Wi-Fi       |
| `NEVER`             | Manual checks only via JS API            |

### Error Recovery State Machine

> **Note:** Error recovery behavior is documented by Expo but is explicitly subject to change between SDK versions. It is not a stable protocol guarantee — treat this as current observed behavior, not a normative specification.

**Branch A -- Content HAS appeared (app was visible to user):**

1. Start 5-second timer
2. Check for new update (unless `checkAutomatically = NEVER`)
3. Download if available
4. On first of: no update / download complete / timer expiry → crash with original error
5. Downloaded update launches on next app open

**Branch B -- Content has NOT appeared (first launch of this update):**

1. Mark update as "failed" locally; it will never launch again on this device
2. Start 5-second timer
3. Check for / download new update
4. If new update downloads before timer → immediately reload and launch
5. If that also crashes → rollback to last successfully launched update
6. If no prior update exists → throw original error

**Threshold:** Fatal JS errors are only intercepted within 10 seconds of first render. Errors after that are not caught by the recovery system.

### Emergency Launch

If the update system itself fails critically (database corruption, etc.), the app launches with the embedded update:

```typescript
import * as Updates from "expo-updates";

if (Updates.isEmergencyLaunch) {
  // Running embedded update due to critical failure
  console.log(Updates.emergencyLaunchReason);
}
```

### Native State Machine (Internal)

> **Note:** This type is internal to `expo-updates` and is not part of the public API. It is documented here for implementors building a compatible client. The shape may change between SDK versions.

```typescript
type UpdatesNativeStateMachineContext = {
  isStartupProcedureRunning: boolean;
  isUpdateAvailable: boolean;
  isUpdatePending: boolean;
  isChecking: boolean;
  isDownloading: boolean;
  isRestarting: boolean;
  restartCount: number;
  latestManifest?: Manifest;
  downloadedManifest?: Manifest;
  rollback?: { commitTime: string }; // Present when a rollback directive is active
  checkError?: Error;
  downloadError?: Error;
  lastCheckForUpdateTime?: Date;
  sequenceNumber: number;
  downloadProgress: number;
};
```

### JavaScript API

**Constants:**

| Constant                | Type                                     | Description                                                       |
| ----------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| `isEnabled`             | `boolean`                                | Whether updates are enabled                                       |
| `updateId`              | `string \| null`                         | UUID of the running update                                        |
| `channel`               | `string \| null`                         | Channel name                                                      |
| `runtimeVersion`        | `string \| null`                         | Runtime version string                                            |
| `checkAutomatically`    | `UpdatesCheckAutomaticallyValue \| null` | Check mode (`ON_LOAD`, `ON_ERROR_RECOVERY`, `WIFI_ONLY`, `NEVER`) |
| `isEmergencyLaunch`     | `boolean`                                | True if running in emergency mode                                 |
| `emergencyLaunchReason` | `string \| null`                         | Reason for emergency launch                                       |
| `isEmbeddedLaunch`      | `boolean`                                | True if running embedded update                                   |
| `manifest`              | `Partial<Manifest>`                      | Current update manifest                                           |
| `createdAt`             | `Date \| null`                           | Creation date of running update                                   |
| `launchDuration`        | `number \| null`                         | Time to launch in ms                                              |
| `latestContext`         | `UpdatesNativeStateMachineContext`       | Latest native state machine context (internal)                    |

**Functions:**

| Function                         | Returns                           | Description                                               |
| -------------------------------- | --------------------------------- | --------------------------------------------------------- |
| `checkForUpdateAsync()`          | `Promise<UpdateCheckResult>`      | Check for available update                                |
| `fetchUpdateAsync()`             | `Promise<UpdateFetchResult>`      | Download available update                                 |
| `reloadAsync(options?)`          | `Promise<void>`                   | Reload app with downloaded update                         |
| `getExtraParamsAsync()`          | `Promise<Record<string, string>>` | Get extra params (maps to `Expo-Extra-Params` SFV header) |
| `setExtraParamAsync(key, value)` | `Promise<void>`                   | Set/delete an extra param (`null` value deletes)          |
| `readLogEntriesAsync(maxAge?)`   | `Promise<UpdatesLogEntry[]>`      | Read update logs                                          |
| `clearLogEntriesAsync()`         | `Promise<void>`                   | Clear update logs                                         |

**Experimental Functions:**

| Function                                        | Returns | Description                                                                                                                                             |
| ----------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setUpdateRequestHeadersOverride(headers)`      | `void`  | Override request headers for update checks. Pass `null` to reset                                                                                        |
| `setUpdateURLAndRequestHeadersOverride(config)` | `void`  | Override both URL and headers. Requires `disableAntiBrickingMeasures: true`. Pass `null` to reset. **Takes effect after full app restart (cold start)** |

**`useUpdates()` Hook:**

```typescript
type UseUpdatesReturnType = {
  currentlyRunning: CurrentlyRunningInfo;
  availableUpdate: UpdateInfo | undefined;
  downloadedUpdate: UpdateInfo | undefined;
  checkError: Error | undefined;
  downloadError: Error | undefined;
  downloadProgress: number | undefined; // 0 to 1
  isChecking: boolean;
  isDownloading: boolean;
  isRestarting: boolean;
  isStartupProcedureRunning: boolean;
  isUpdateAvailable: boolean;
  isUpdatePending: boolean;
  lastCheckForUpdateTimeSinceRestart: Date | undefined;
  restartCount: number;
};
```

### Error Codes

| Code                              | Cause                                   |
| --------------------------------- | --------------------------------------- |
| `ERR_UPDATES_DISABLED`            | Updates disabled or in development mode |
| `ERR_UPDATES_RELOAD`              | Failed to reload                        |
| `ERR_UPDATES_CHECK`               | Unexpected error checking for update    |
| `ERR_UPDATES_FETCH`               | Unexpected error fetching update        |
| `ERR_UPDATES_READ_LOGS`           | Unexpected error reading logs           |
| `ERR_NOT_AVAILABLE_IN_DEV_CLIENT` | Method unavailable in dev builds        |

### Log Entry Codes

| Code                           | Value                         |
| ------------------------------ | ----------------------------- |
| `NONE`                         | `"None"`                      |
| `NO_UPDATES_AVAILABLE`         | `"NoUpdatesAvailable"`        |
| `UPDATE_ASSETS_NOT_AVAILABLE`  | `"UpdateAssetsNotAvailable"`  |
| `UPDATE_SERVER_UNREACHABLE`    | `"UpdateServerUnreachable"`   |
| `UPDATE_HAS_INVALID_SIGNATURE` | `"UpdateHasInvalidSignature"` |
| `UPDATE_CODE_SIGNING_ERROR`    | `"UpdateCodeSigningError"`    |
| `UPDATE_FAILED_TO_LOAD`        | `"UpdateFailedToLoad"`        |
| `ASSETS_FAILED_TO_LOAD`        | `"AssetsFailedToLoad"`        |
| `JS_RUNTIME_ERROR`             | `"JSRuntimeError"`            |
| `INITIALIZATION_ERROR`         | `"InitializationError"`       |
| `UNKNOWN`                      | `"Unknown"`                   |

---

## 14. Configuration Reference

### app.json Properties

| Property                              | Type                     | Default     | Description                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `updates.enabled`                     | `boolean`                | `true`      | Enable/disable OTA updates                                                                                                                                                                                                                                                                                                                                                                        |
| `updates.url`                         | `string`                 | required    | Update server URL                                                                                                                                                                                                                                                                                                                                                                                 |
| `updates.requestHeaders`              | `Record<string, string>` | none        | Extra headers sent with manifest and asset requests                                                                                                                                                                                                                                                                                                                                               |
| `updates.checkAutomatically`          | `string`                 | `"ON_LOAD"` | When to check (`ON_LOAD`, `ON_ERROR_RECOVERY`, `WIFI_ONLY`, `NEVER`)                                                                                                                                                                                                                                                                                                                              |
| `updates.fallbackToCacheTimeout`      | `number`                 | `0`         | Max ms to wait for update before launching cached (0 = no wait)                                                                                                                                                                                                                                                                                                                                   |
| `updates.useEmbeddedUpdate`           | `boolean`                | `true`      | Whether the build includes an embedded update                                                                                                                                                                                                                                                                                                                                                     |
| `updates.codeSigningCertificate`      | `string`                 | none        | Path to PEM certificate file                                                                                                                                                                                                                                                                                                                                                                      |
| `updates.codeSigningMetadata`         | `object`                 | none        | `{ keyid, alg }` for code signing                                                                                                                                                                                                                                                                                                                                                                 |
| `updates.assetPatternsToBeBundled`    | `string[]`               | none        | Glob patterns for OTA-bundled assets                                                                                                                                                                                                                                                                                                                                                              |
| `updates.disableAntiBrickingMeasures` | `boolean`                | `false`     | Disable error recovery protections                                                                                                                                                                                                                                                                                                                                                                |
| `updates.enableBsdiffPatchSupport`    | `boolean`                | `true`      | Build-time client hint: whether the device advertises `A-IM: bsdiff` on launch-asset downloads. The real `expo-updates` client defaults this to `true` (SDK 56). `better-update` does NOT read this flag — it negotiates patch-vs-full purely from the runtime `A-IM` request header, serving a precomputed bsdiff patch to opted-in clients (`A-IM: bsdiff`) and a full bundle to everyone else. |
| `runtimeVersion`                      | `string \| { policy }`   | required    | Runtime version or policy                                                                                                                                                                                                                                                                                                                                                                         |

### iOS (Expo.plist)

| Key                                    | Type         | Maps To                                                                                                                                      |
| -------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXUpdatesEnabled`                     | `Boolean`    | `updates.enabled`                                                                                                                            |
| `EXUpdatesURL`                         | `String`     | `updates.url`                                                                                                                                |
| `EXUpdatesRequestHeaders`              | `Dictionary` | `updates.requestHeaders`                                                                                                                     |
| `EXUpdatesRuntimeVersion`              | `String`     | `runtimeVersion`                                                                                                                             |
| `EXUpdatesCheckOnLaunch`               | `String`     | `updates.checkAutomatically` (values: `ALWAYS`, `WIFI_ONLY`, `ERROR_RECOVERY_ONLY`, `NEVER`)                                                 |
| `EXUpdatesLaunchWaitMs`                | `Number`     | `updates.fallbackToCacheTimeout`                                                                                                             |
| `EXUpdatesHasEmbeddedUpdate`           | `Boolean`    | `updates.useEmbeddedUpdate`                                                                                                                  |
| `EXUpdatesCodeSigningCertificate`      | `String`     | `updates.codeSigningCertificate` (XML-escaped PEM)                                                                                           |
| `EXUpdatesCodeSigningMetadata`         | `Dictionary` | `updates.codeSigningMetadata`                                                                                                                |
| `EXUpdatesDisableAntiBrickingMeasures` | `Boolean`    | `updates.disableAntiBrickingMeasures`                                                                                                        |
| `EXUpdatesEnableBsdiffPatchSupport`    | `Boolean`    | `updates.enableBsdiffPatchSupport` (controls whether the device sends `A-IM: bsdiff`; the server negotiates from that header, not this flag) |

### Android (AndroidManifest.xml)

| `meta-data` name                                                 | Type      | Maps To                                                                                                                                      |
| ---------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `expo.modules.updates.ENABLED`                                   | `boolean` | `updates.enabled`                                                                                                                            |
| `expo.modules.updates.EXPO_UPDATE_URL`                           | `string`  | `updates.url`                                                                                                                                |
| `expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY` | `string`  | `updates.requestHeaders`                                                                                                                     |
| `expo.modules.updates.EXPO_RUNTIME_VERSION`                      | `string`  | `runtimeVersion`                                                                                                                             |
| `expo.modules.updates.EXPO_UPDATES_CHECK_ON_LAUNCH`              | `string`  | `updates.checkAutomatically` (values: `ALWAYS`, `WIFI_ONLY`, `ERROR_RECOVERY_ONLY`, `NEVER`)                                                 |
| `expo.modules.updates.EXPO_UPDATES_LAUNCH_WAIT_MS`               | `int`     | `updates.fallbackToCacheTimeout`                                                                                                             |
| `expo.modules.updates.HAS_EMBEDDED_UPDATE`                       | `boolean` | `updates.useEmbeddedUpdate`                                                                                                                  |
| `expo.modules.updates.CODE_SIGNING_CERTIFICATE`                  | `string`  | `updates.codeSigningCertificate` (XML-escaped PEM)                                                                                           |
| `expo.modules.updates.CODE_SIGNING_METADATA`                     | `string`  | `updates.codeSigningMetadata` (JSON string)                                                                                                  |
| `expo.modules.updates.DISABLE_ANTI_BRICKING_MEASURES`            | `boolean` | `updates.disableAntiBrickingMeasures`                                                                                                        |
| `expo.modules.updates.ENABLE_BSDIFF_PATCH_SUPPORT`               | `boolean` | `updates.enableBsdiffPatchSupport` (controls whether the device sends `A-IM: bsdiff`; the server negotiates from that header, not this flag) |

---

## 15. Request/Response Flow

### Complete Update Check Flow

```text
Client                              Update Server                    Asset CDN
  |                                      |                              |
  |  GET /manifest                       |                              |
  |  expo-protocol-version: 1            |                              |
  |  expo-platform: ios                  |                              |
  |  expo-runtime-version: 1.0.0         |                              |
  |  expo-channel-name: production       |                              |
  |  expo-expect-signature: sig,keyid=.. |                              |
  |  expo-extra-params: ...              |                              |
  |  accept: multipart/mixed             |                              |
  | ---------------------------------->  |                              |
  |                                      |                              |
  |                                      |  Resolve: channel ->         |
  |                                      |  branch -> latest update     |
  |                                      |  matching platform +         |
  |                                      |  runtime version             |
  |                                      |                              |
  |  200 OK                              |                              |
  |  content-type: multipart/mixed       |                              |
  |  expo-protocol-version: 1            |                              |
  |  expo-sfv-version: 0                 |                              |
  |  expo-manifest-filters: ...          |                              |
  |  cache-control: private, max-age=0   |                              |
  |  [manifest part + extensions part]   |                              |
  | <----------------------------------  |                              |
  |                                      |                              |
  |  Verify code signature (if present)  |                              |
  |  Compare manifest.id with cached     |                              |
  |  Apply manifest-filters to store     |                              |
  |                                      |                              |
  |  IF new update available:            |                              |
  |                                      |                              |
  |  GET /assets/bundle.js               |                              |
  |  (+ assetRequestHeaders)             |                              |
  |-------------------------------------------------------------------->|
  |                                      |                              |
  |  200 OK                              |                              |
  |  content-type: application/javascript|                              |
  |  cache-control: immutable            |                              |
  |<--------------------------------------------------------------------|
  |                                      |                              |
  |  Verify SHA-256 hash                 |                              |
  |  Cache asset locally                 |                              |
  |  (repeat for each new asset)         |                              |
  |                                      |                              |
  |  Mark update as downloaded           |                              |
  |  Launch on next app start            |                              |
  |                                      |                              |
```

### No Update Available

```text
Client                              Update Server
  |  GET /manifest                       |
  |  (same headers as above)             |
  | ---------------------------------->  |
  |                                      |
  |  204 No Content                      |
  |  (or 200 with empty multipart)       |
  | <----------------------------------  |
  |                                      |
  |  No action taken                     |
```

### Rollback Flow

```text
Client                              Update Server
  |  GET /manifest                       |
  |  (same headers as above)             |
  | ---------------------------------->  |
  |                                      |
  |  200 OK                              |
  |  content-type: multipart/mixed       |
  |  [directive part: rollBackToEmbedded]|
  | <----------------------------------  |
  |                                      |
  |  Verify directive signature          |
  |  Use embedded update                 |
```

---

## Protocol v0 vs v1

| Aspect               | Classic (v0)             | EAS Update (v1)                             |
| -------------------- | ------------------------ | ------------------------------------------- |
| Compatibility key    | `sdkVersion`             | `runtimeVersion`                            |
| Channel concept      | `releaseChannel`         | `channel`                                   |
| Manifest accessor    | `Constants.manifest`     | `Updates.manifest`                          |
| Channel API          | `Updates.releaseChannel` | `Updates.channel`                           |
| Publish command      | `expo publish`           | `eas update`                                |
| Last supported SDK   | SDK 49                   | Current                                     |
| Minimum requirements | --                       | SDK 45, expo-updates 0.13.0, EAS CLI 0.50.0 |

---

## References

- [Expo Updates Protocol v1 Spec](https://docs.expo.dev/technical-specs/expo-updates-1/)
- [EAS Update: How It Works](https://docs.expo.dev/eas-update/how-it-works/)
- [EAS Update: Runtime Versions](https://docs.expo.dev/eas-update/runtime-versions/)
- [EAS Update: Code Signing](https://docs.expo.dev/eas-update/code-signing/)
- [EAS Update: Rollbacks](https://docs.expo.dev/eas-update/rollbacks/)
- [expo-updates SDK Reference](https://docs.expo.dev/versions/latest/sdk/updates/)
- [Custom Expo Updates Server (Reference Implementation)](https://github.com/expo/custom-expo-updates-server)
- [expo-updates Source Code](https://github.com/expo/expo/tree/main/packages/expo-updates)
