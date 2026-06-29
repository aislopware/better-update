/// <reference types="vitest/globals" />

import { fromBase64, toBase64 } from "@better-update/encoding";

import {
  generateAccountKey,
  generateVaultKey,
  openAccountKey,
  sealAccountKey,
  unwrapVaultKey,
  wrapVaultKey,
} from "./index";

import type { AccountKeyEnvelope } from "./index";

// Argon2id is deliberately expensive; tiny params keep the round-trip tests fast.
const fastKdf = { time: 1, memory: 256, parallelism: 1 };
const passphrase = "correct horse battery staple";

const tamper = (b64: string): string =>
  toBase64(fromBase64(b64).map((byte, index) => (index === 0 ? (byte + 1) % 256 : byte)));

describe("account key", () => {
  it("generates an age + ed25519 keypair", async () => {
    const key = await generateAccountKey();
    expect(key.agePrivateKey).toMatch(/^AGE-SECRET-KEY-1/u);
    expect(key.agePublicKey).toMatch(/^age1/u);
    expect(key.fingerprint).toMatch(/^SHA256:/u);
    expect(fromBase64(key.ed25519PrivateKey)).toHaveLength(32);
    expect(fromBase64(key.ed25519PublicKey)).toHaveLength(32);
  });

  it("seals and opens an escrow envelope round-trip", async () => {
    const key = await generateAccountKey();
    const envelope = sealAccountKey({ material: key, passphrase, kdfParams: fastKdf });
    expect(envelope.version).toBe(1);
    expect(envelope.agePublicKey).toBe(key.agePublicKey);
    expect(envelope.ed25519PublicKey).toBe(key.ed25519PublicKey);
    expect(envelope.kdf).toBe("argon2id");

    const opened = await openAccountKey({ envelope, passphrase });
    expect(opened.agePrivateKey).toBe(key.agePrivateKey);
    expect(opened.agePublicKey).toBe(key.agePublicKey);
    expect(opened.ed25519PrivateKey).toBe(key.ed25519PrivateKey);
    expect(opened.ed25519PublicKey).toBe(key.ed25519PublicKey);
    expect(opened.fingerprint).toBe(key.fingerprint);
  });

  it("rejects a wrong passphrase", async () => {
    const key = await generateAccountKey();
    const envelope = sealAccountKey({ material: key, passphrase, kdfParams: fastKdf });
    await expect(openAccountKey({ envelope, passphrase: "nope" })).rejects.toThrow(Error);
  });

  it("rejects a tampered ciphertext", async () => {
    const key = await generateAccountKey();
    const envelope = sealAccountKey({ material: key, passphrase, kdfParams: fastKdf });
    const tampered: AccountKeyEnvelope = { ...envelope, ct: tamper(envelope.ct) };
    await expect(openAccountKey({ envelope: tampered, passphrase })).rejects.toThrow(Error);
  });

  it("rejects a swapped public key (AAD binding)", async () => {
    const other = await generateAccountKey();
    const key = await generateAccountKey();
    const envelope = sealAccountKey({ material: key, passphrase, kdfParams: fastKdf });
    const tampered: AccountKeyEnvelope = { ...envelope, agePublicKey: other.agePublicKey };
    await expect(openAccountKey({ envelope: tampered, passphrase })).rejects.toThrow(Error);
  });

  it("the unsealed age key can unwrap an env-vault key wrapped to it", async () => {
    // The end-to-end shape the browser relies on: account age key is an env-vault
    // recipient, so unsealing the escrow yields a key that opens the EV wrap.
    const key = await generateAccountKey();
    const envelope = sealAccountKey({ material: key, passphrase, kdfParams: fastKdf });
    const envVaultKey = generateVaultKey();
    const wrapped = await wrapVaultKey({ vaultKey: envVaultKey, recipient: key.agePublicKey });

    const opened = await openAccountKey({ envelope, passphrase });
    const unwrapped = await unwrapVaultKey({ wrapped, privateKey: opened.agePrivateKey });
    expect([...unwrapped]).toStrictEqual([...envVaultKey]);
  });
});
