import { toBase64 } from "@better-update/encoding";

/** The opaque client-encrypted envelope every secret-credential upload now carries. */
export interface CredentialEnvelope {
  readonly id: string;
  readonly ciphertext: string;
  readonly wrappedDek: string;
  readonly vaultVersion: number;
}

/** Random bytes as base64 — a stand-in for an opaque encrypted field. */
const randomBase64 = (bytes: number): string =>
  toBase64(crypto.getRandomValues(new Uint8Array(bytes)));

/**
 * Build a placeholder client-encrypted envelope for an e2e upload. The server is
 * zero-knowledge: it only base64-decodes `ciphertext` (to relay it to R2) and
 * stores `wrappedDek`/`vaultVersion` verbatim, never decrypting. These e2e tests
 * assert on the public metadata the server echoes back — not on a decryption
 * round-trip — so a valid-base64 opaque envelope (no real vault key or DEK) is
 * enough to exercise the upload contract. Real sealing is covered by the CLI
 * unit tests against `@better-update/credentials-crypto`.
 */
export const credentialEnvelope = (): CredentialEnvelope => ({
  id: crypto.randomUUID(),
  ciphertext: randomBase64(64),
  wrappedDek: randomBase64(48),
  vaultVersion: 1,
});
