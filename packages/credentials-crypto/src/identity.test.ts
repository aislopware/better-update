/// <reference types="vitest/globals" />

import { fromBase64, toBase64 } from "@better-update/encoding";

import { deriveRecipient, generateIdentity, openIdentity, sealIdentity } from "./index";

import type { IdentityFile } from "./index";

// Argon2id is deliberately expensive; tiny params keep the round-trip tests fast.
const fastKdf = { time: 1, memory: 256, parallelism: 1 };
const passphrase = "correct horse battery staple";

const tamper = (b64: string): string =>
  toBase64(fromBase64(b64).map((byte, index) => (index === 0 ? (byte + 1) % 256 : byte)));

describe("identity", () => {
  it("generates an age identity with a recipient and fingerprint", async () => {
    const id = await generateIdentity();
    expect(id.privateKey).toMatch(/^AGE-SECRET-KEY-1/u);
    expect(id.publicKey).toMatch(/^age1/u);
    expect(id.fingerprint).toMatch(/^SHA256:/u);
    await expect(deriveRecipient(id.privateKey)).resolves.toBe(id.publicKey);
  });

  it("seals and opens an identity round-trip", async () => {
    const id = await generateIdentity();
    const file = await sealIdentity({ privateKey: id.privateKey, passphrase, kdfParams: fastKdf });
    expect(file.version).toBe(1);
    expect(file.publicKey).toBe(id.publicKey);
    expect(file.kdf).toBe("argon2id");

    const opened = await openIdentity({ file, passphrase });
    expect(opened.privateKey).toBe(id.privateKey);
    expect(opened.publicKey).toBe(id.publicKey);
    expect(opened.fingerprint).toBe(id.fingerprint);
  });

  it("rejects a wrong passphrase", async () => {
    const id = await generateIdentity();
    const file = await sealIdentity({ privateKey: id.privateKey, passphrase, kdfParams: fastKdf });
    await expect(openIdentity({ file, passphrase: "wrong passphrase" })).rejects.toThrow(Error);
  });

  it("rejects a tampered ciphertext", async () => {
    const id = await generateIdentity();
    const file = await sealIdentity({ privateKey: id.privateKey, passphrase, kdfParams: fastKdf });
    const tampered: IdentityFile = { ...file, ct: tamper(file.ct) };
    await expect(openIdentity({ file: tampered, passphrase })).rejects.toThrow(Error);
  });

  it("rejects a swapped public key (AAD binding)", async () => {
    const other = await generateIdentity();
    const id = await generateIdentity();
    const file = await sealIdentity({ privateKey: id.privateKey, passphrase, kdfParams: fastKdf });
    const tampered: IdentityFile = { ...file, publicKey: other.publicKey };
    await expect(openIdentity({ file: tampered, passphrase })).rejects.toThrow(Error);
  });
});
