export { aeadDecrypt, aeadEncrypt, encodeAad, fingerprint, randomKey } from "./aead";
export {
  DEFAULT_ARGON2_PARAMS,
  deriveRecipient,
  generateIdentity,
  openIdentity,
  sealIdentity,
} from "./identity";
export type { Argon2Params, Identity, IdentityFile } from "./identity";
export {
  generateDek,
  generateVaultKey,
  unwrapDek,
  unwrapVaultKey,
  wrapDek,
  wrapVaultKey,
} from "./vault";
export type { DekBinding } from "./vault";
export { openCredential, sealCredential, SCHEMA_VERSION } from "./credential";
export type { CredentialBinding, CredentialPayload } from "./credential";
