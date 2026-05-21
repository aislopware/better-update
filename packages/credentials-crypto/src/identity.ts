import { fromBase64, toBase64 } from "@better-update/encoding";
import { randomBytes } from "@noble/ciphers/utils.js";
import { argon2id } from "@noble/hashes/argon2.js";
import { generateIdentity as ageGenerateIdentity, identityToRecipient } from "age-encryption";

import { aeadDecrypt, aeadEncrypt, encodeAad, fingerprint } from "./aead";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const SALT_BYTES = 16;
const KEY_BYTES = 32;

/** Argon2id cost parameters for sealing the identity key at rest. */
export interface Argon2Params {
  time: number;
  memory: number;
  parallelism: number;
}

/** OWASP-recommended Argon2id defaults (~64 MiB), tuned for ~250–500 ms. */
export const DEFAULT_ARGON2_PARAMS: Argon2Params = { time: 3, memory: 65_536, parallelism: 1 };

/** An X25519 identity: the age private key, its recipient, and a fingerprint. */
export interface Identity {
  privateKey: string;
  publicKey: string;
  fingerprint: string;
}

/** On-disk envelope (`~/.better-update/identity.json`) sealing the private key. */
export interface IdentityFile {
  version: 1;
  publicKey: string;
  fingerprint: string;
  kdf: "argon2id";
  kdfParams: Argon2Params;
  salt: string;
  cipher: "xchacha20poly1305";
  ct: string;
}

/** Generate a fresh X25519 identity with its recipient string and fingerprint. */
export const generateIdentity = async (): Promise<Identity> => {
  const privateKey = await ageGenerateIdentity();
  const publicKey = await identityToRecipient(privateKey);
  return { privateKey, publicKey, fingerprint: fingerprint(publicKey) };
};

/** Derive the age recipient (`age1...`) from an identity private key. */
export const deriveRecipient = async (privateKey: string): Promise<string> =>
  identityToRecipient(privateKey);

const deriveKek = (passphrase: string, salt: Uint8Array, params: Argon2Params): Uint8Array => {
  /* eslint-disable id-length -- @noble/hashes argon2id requires fixed single-letter cost keys (t/m/p) */
  const options = { t: params.time, m: params.memory, p: params.parallelism, dkLen: KEY_BYTES };
  /* eslint-enable id-length */
  return argon2id(passphrase, salt, options);
};

const sealAad = (
  header: Pick<IdentityFile, "publicKey" | "fingerprint" | "kdfParams">,
): Uint8Array =>
  encodeAad("better-update/identity", [
    header.publicKey,
    header.fingerprint,
    header.kdfParams.time,
    header.kdfParams.memory,
    header.kdfParams.parallelism,
  ]);

/** Seal an identity private key into the on-disk envelope with a passphrase. */
export const sealIdentity = async (args: {
  privateKey: string;
  passphrase: string;
  kdfParams?: Argon2Params;
}): Promise<IdentityFile> => {
  const publicKey = await identityToRecipient(args.privateKey);
  const kdfParams = args.kdfParams ?? DEFAULT_ARGON2_PARAMS;
  const fp = fingerprint(publicKey);
  const salt = randomBytes(SALT_BYTES);
  const kek = deriveKek(args.passphrase, salt, kdfParams);
  const ct = aeadEncrypt(
    kek,
    textEncoder.encode(args.privateKey),
    sealAad({ publicKey, fingerprint: fp, kdfParams }),
  );
  return {
    version: 1,
    publicKey,
    fingerprint: fp,
    kdf: "argon2id",
    kdfParams,
    salt: toBase64(salt),
    cipher: "xchacha20poly1305",
    ct: toBase64(ct),
  };
};

/**
 * Open an identity envelope. Throws (propagated AEAD failure) if the passphrase
 * is wrong or the file was tampered — the seal binds `publicKey`, `fingerprint`,
 * and the KDF params as AAD. The returned `publicKey` is **re-derived from the
 * decrypted private key**, so it always matches the key it unlocks.
 */
export const openIdentity = async (args: {
  file: IdentityFile;
  passphrase: string;
}): Promise<Identity> => {
  const { file } = args;
  const kek = deriveKek(args.passphrase, fromBase64(file.salt), file.kdfParams);
  const privateKey = textDecoder.decode(aeadDecrypt(kek, fromBase64(file.ct), sealAad(file)));
  const publicKey = await identityToRecipient(privateKey);
  return { privateKey, publicKey, fingerprint: fingerprint(publicKey) };
};
