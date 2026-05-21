import { aeadDecrypt, aeadEncrypt, encodeAad } from "./aead";

/** Current credential-payload schema version (bumped on a breaking shape change). */
export const SCHEMA_VERSION = 1;

/**
 * The plaintext sealed into the R2 blob: a typed, versioned struct whose
 * identifying fields are duplicated **inside** the ciphertext and bound as AAD.
 * `metadata` mirrors the (public, server-visible) D1 row so the CLI can verify
 * the server did not swap it; `secret` holds the actual key material (the CLI
 * decides its per-type shape, e.g. `{ p12, password }` or `{ pem }`).
 */
export interface CredentialPayload {
  schemaVersion: number;
  orgId: string;
  credentialId: string;
  credentialType: string;
  metadata: Record<string, unknown>;
  secret: Record<string, unknown>;
}

/** The identity a credential blob is cryptographically bound to. */
export type CredentialBinding = Pick<
  CredentialPayload,
  "schemaVersion" | "orgId" | "credentialId" | "credentialType"
>;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const blobAad = (binding: CredentialBinding): Uint8Array =>
  encodeAad("better-update/credential", [
    binding.orgId,
    binding.credentialId,
    binding.credentialType,
    binding.schemaVersion,
  ]);

/** Encrypt a credential payload with its DEK, binding its identity as AAD. */
export const sealCredential = (args: { dek: Uint8Array; payload: CredentialPayload }): Uint8Array =>
  aeadEncrypt(args.dek, textEncoder.encode(JSON.stringify(args.payload)), blobAad(args.payload));

/**
 * Decrypt a credential blob with its DEK. The AAD binds the blob to `expect`, so
 * a blob for another (org, credential, type, schema) fails the tag instead of
 * silently yielding the wrong credential. Returns the parsed payload as
 * `unknown`; the caller validates its shape (Effect Schema) and re-checks the
 * embedded metadata against the server row.
 */
export const openCredential = (args: {
  dek: Uint8Array;
  ciphertext: Uint8Array;
  expect: CredentialBinding;
}): unknown => {
  const plaintext = aeadDecrypt(args.dek, args.ciphertext, blobAad(args.expect));
  const parsed: unknown = JSON.parse(textDecoder.decode(plaintext));
  return parsed;
};
