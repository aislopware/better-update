# 10. Code Signing

## Architecture

Code signing follows the EAS CLI model:

- **The publisher signs everything** — both manifests and directives — before uploading
- The server stores and forwards signatures as-is
- The client verifies against its embedded certificate
- Private keys never touch the server

## How It Works (EAS CLI Flow)

**For manifest updates:**

1. Publisher builds the manifest JSON locally (or the server returns it after asset upload)
2. Publisher signs the manifest JSON with their private key: `RSA-SHA256(manifestJson, privateKey)`
3. Publisher sends the signed update to the server: `POST /api/updates` with `signature` and `certificateChain` fields
4. Server stores `signature` and `certificate_chain` in the `updates` table

**For rollback directives:**

1. Publisher constructs the directive JSON locally:
   ```json
   { "type": "rollBackToEmbedded", "parameters": { "commitTime": "..." } }
   ```
2. Publisher signs the directive JSON with their private key
3. Publisher sends the signed directive to the server: `POST /api/updates` with `is_rollback = 1`, `signature`, and `certificateChain`
4. Server stores it identically to a signed manifest update

This means the `POST /api/updates/rollback` endpoint from the unsigned flow is replaced: the publisher must construct and sign the full directive before submitting it as a regular update entry with `is_rollback = 1`.

## Server Responsibilities

1. **Store:** Accept `signature` and `certificate_chain` from publisher at publish time
2. **Serve:** Return `expo-signature` as a part header on `manifest` or `directive` parts
3. **Serve:** Include `certificate_chain` as a separate multipart part when stored
4. **Detect:** Read `expo-expect-signature` request header to know if the client expects signing

## Structural Validation at Publish Time

While the server does not validate cryptographic signatures (that is the client's job), it **must** validate that a signed `manifestBody` or `directiveBody` is structurally consistent with the relational fields in the publish request. This prevents a critical failure mode where the server resolves a manifest based on relational data (branch, platform, runtimeVersion) but serves a signed body containing different values.

**Validation performed on `manifestBody`:**

- `runtimeVersion` in the signed body matches the request's `runtimeVersion`
- Asset keys and hashes in the signed body match the `assets[]` array in the request
- `extra` fields are consistent (if provided)

**Validation performed on `directiveBody`:**

- `type` must be `"rollBackToEmbedded"`
- `parameters.commitTime` must be valid ISO 8601

If validation fails, the server returns `400 Bad Request` before writing any data. See [spec 06](./06-publishing.md#signed-body-structural-validation) for the full validation rules.

## What the Server Does NOT Do

- Generate, store, or manage private keys
- Sign any content (manifests, directives, or assets)
- Validate cryptographic signatures (that's the client's job)
- Modify manifest/directive JSON after the publisher signs it (would invalidate the signature)

## Multipart Response Structure (with Signing)

**Manifest response:**

| Part                | `content-type`                      | Part header                                                      | Body                               |
| ------------------- | ----------------------------------- | ---------------------------------------------------------------- | ---------------------------------- |
| `manifest`          | `application/json`                  | `expo-signature: sig="...", keyid="main", alg="rsa-v1_5-sha256"` | Manifest JSON (verbatim as signed) |
| `extensions`        | `application/json`                  | —                                                                | `{"assetRequestHeaders":{}}`       |
| `certificate_chain` | `application/pem-certificate-chain` | —                                                                | PEM certificate chain              |

**Directive response:**

| Part                | `content-type`                      | Part header                                                      | Body                                               |
| ------------------- | ----------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| `directive`         | `application/json`                  | `expo-signature: sig="...", keyid="main", alg="rsa-v1_5-sha256"` | `{"type":"rollBackToEmbedded","parameters":{...}}` |
| `certificate_chain` | `application/pem-certificate-chain` | —                                                                | PEM certificate chain                              |

## Implications

Since the server must serve the manifest JSON **exactly as the publisher signed it**, the server cannot reconstruct the manifest at serve time. Two approaches:

**Option A (recommended): Publisher constructs full manifest.** The publisher builds the complete manifest JSON (including asset URLs), signs it, and uploads it. The server stores the signed manifest body verbatim and serves it as-is. This requires the publisher to know the asset CDN URL pattern.

**Option B: Two-phase signing.** The server returns a draft manifest after asset upload, the publisher signs it, then the publisher submits the signature. More round-trips but the server controls manifest construction.

`better-update` uses **Option A** — the publisher is responsible for constructing the manifest JSON with correct asset URLs (`https://cdn.updates.example.com/assets/{hash}`) before signing.

## Key Compromise & Rotation

The publisher-signs-everything model protects against server tampering, but does not inherently handle signer compromise or key rotation.

### Threat: Compromised Publisher Key

If a publisher's private key is compromised, an attacker can sign arbitrary malicious updates. The server cannot distinguish legitimate from malicious signatures — both are valid.

### Mitigation: Key Rotation Procedure

1. **Revoke the compromised key:** Update the client-embedded certificate to stop trusting the old key. This requires a native app release (binary update).
2. **Rotate the server-side config:** If the server validates certificate chains against an allowlist (optional enhancement), remove the compromised certificate from the allowlist.
3. **Re-sign affected updates:** Republish all active updates with the new key. Old signed updates remain in the database but will fail client verification once the old certificate is distrusted.
4. **Emergency rollback:** Use `rollBackToEmbedded` to force devices back to the app binary while the situation is resolved. The rollback directive must be signed with the new key.

### Limitation: No Server-Side Revocation

Since the server does not validate signatures (that is the client's responsibility), there is no server-side revocation mechanism. The server will continue to store and serve updates signed with the compromised key until they are overwritten or deleted. Client-side certificate pinning is the primary defense.

### Future Enhancement: Certificate Allowlist

An optional server-side enhancement: maintain a per-project certificate allowlist. At publish time, validate that the provided `certificateChain` matches an allowed certificate. This adds a defense-in-depth layer but is not required for the initial implementation.
