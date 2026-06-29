import { Decrypter, Encrypter } from "age-encryption";

import { aeadDecrypt, aeadEncrypt, encodeAad, randomKey } from "./aead";

/** Generate a fresh 32-byte org vault key (the root of credential encryption). */
export const generateVaultKey = (): Uint8Array => randomKey();

/** Generate a fresh 32-byte per-credential data key (DEK). */
export const generateDek = (): Uint8Array => randomKey();

/**
 * Wrap the org vault key to a recipient's public key via age — one
 * single-recipient blob per recipient, stored in `org_vault_key_wraps`.
 */
export const wrapVaultKey = async (args: {
  vaultKey: Uint8Array;
  recipient: string;
}): Promise<Uint8Array> => {
  const encrypter = new Encrypter();
  encrypter.addRecipient(args.recipient);
  return encrypter.encrypt(args.vaultKey);
};

/** Unwrap the org vault key with an identity private key. Throws if it is not a recipient. */
export const unwrapVaultKey = async (args: {
  wrapped: Uint8Array;
  privateKey: string;
}): Promise<Uint8Array> => {
  const decrypter = new Decrypter();
  decrypter.addIdentity(args.privateKey);
  return decrypter.decrypt(args.wrapped);
};

/**
 * Which of the two org vaults a DEK belongs to. The org's secrets are split
 * across a credentials vault (signing credentials, CLI-only) and an env vault
 * (env-var values, also reachable from the browser via an account key). The two
 * vaults hold DIFFERENT keys — the difference alone already makes a cross-vault
 * unwrap fail the AEAD tag — and `vaultKind` is folded into the DEK AAD as an
 * explicit, auditable second guard. See docs/specs/build/11-two-vault-split-and-web-env-crud.md.
 */
export type VaultKind = "credentials" | "env";

/** Binds a DEK wrap to one (org, credential) under a specific vault + version. */
export interface DekBinding {
  orgId: string;
  credentialId: string;
  vaultVersion: number;
  vaultKind: VaultKind;
}

const dekAad = (binding: DekBinding): Uint8Array =>
  // `credentials` reproduces the PRE-SPLIT AAD (no kind segment) verbatim, so every
  // DEK sealed before the two-vault split still verifies unchanged. `env` folds in
  // the kind so an env DEK can never be opened under the credentials vault.
  binding.vaultKind === "env"
    ? encodeAad("better-update/dek", [
        binding.orgId,
        binding.credentialId,
        binding.vaultVersion,
        "env",
      ])
    : encodeAad("better-update/dek", [binding.orgId, binding.credentialId, binding.vaultVersion]);

/** Wrap a per-credential DEK under the vault key, bound to (org, credential, vaultVersion). */
export const wrapDek = (args: {
  dek: Uint8Array;
  vaultKey: Uint8Array;
  binding: DekBinding;
}): Uint8Array => aeadEncrypt(args.vaultKey, args.dek, dekAad(args.binding));

/**
 * Unwrap a DEK. Throws (propagated AEAD failure) if the vault key, the binding,
 * or the wrap was altered — a wrap cannot be replayed under a different
 * credential or a stale vault version.
 */
export const unwrapDek = (args: {
  wrappedDek: Uint8Array;
  vaultKey: Uint8Array;
  binding: DekBinding;
}): Uint8Array => aeadDecrypt(args.vaultKey, args.wrappedDek, dekAad(args.binding));
