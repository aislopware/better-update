/// <reference types="vitest/globals" />

import {
  aeadEncrypt,
  encodeAad,
  generateDek,
  generateIdentity,
  generateVaultKey,
  unwrapDek,
  unwrapVaultKey,
  wrapDek,
  wrapVaultKey,
} from "./index";

import type { DekBinding } from "./index";

describe("vault key wrapping (age recipients)", () => {
  it("wraps and unwraps to the same recipient", async () => {
    const id = await generateIdentity();
    const vaultKey = generateVaultKey();
    const wrapped = await wrapVaultKey({ vaultKey, recipient: id.publicKey });
    const unwrapped = await unwrapVaultKey({ wrapped, privateKey: id.privateKey });
    expect([...unwrapped]).toStrictEqual([...vaultKey]);
  });

  it("cannot be unwrapped by a non-recipient", async () => {
    const id = await generateIdentity();
    const stranger = await generateIdentity();
    const wrapped = await wrapVaultKey({ vaultKey: generateVaultKey(), recipient: id.publicKey });
    await expect(unwrapVaultKey({ wrapped, privateKey: stranger.privateKey })).rejects.toThrow(
      Error,
    );
  });
});

describe("DEK wrapping (vault key + AAD binding)", () => {
  const binding: DekBinding = {
    orgId: "org_1",
    credentialId: "cred_1",
    vaultVersion: 1,
    vaultKind: "credentials",
  };

  it("wraps and unwraps under the same binding", () => {
    const vaultKey = generateVaultKey();
    const dek = generateDek();
    const wrapped = wrapDek({ dek, vaultKey, binding });
    expect([...unwrapDek({ wrappedDek: wrapped, vaultKey, binding })]).toStrictEqual([...dek]);
  });

  it("rejects a different vault key", () => {
    const wrapped = wrapDek({ dek: generateDek(), vaultKey: generateVaultKey(), binding });
    expect(() => unwrapDek({ wrappedDek: wrapped, vaultKey: generateVaultKey(), binding })).toThrow(
      Error,
    );
  });

  it.each([
    { ...binding, orgId: "org_2" },
    { ...binding, credentialId: "cred_2" },
    { ...binding, vaultVersion: 2 },
    { ...binding, vaultKind: "env" as const },
  ])("rejects a mismatched binding %o", (wrongBinding) => {
    const vaultKey = generateVaultKey();
    const wrapped = wrapDek({ dek: generateDek(), vaultKey, binding });
    expect(() => unwrapDek({ wrappedDek: wrapped, vaultKey, binding: wrongBinding })).toThrow(
      Error,
    );
  });

  it("the env vault-kind round-trips under its own binding", () => {
    const vaultKey = generateVaultKey();
    const dek = generateDek();
    const envBinding: DekBinding = { ...binding, vaultKind: "env" };
    const wrapped = wrapDek({ dek, vaultKey, binding: envBinding });
    expect([...unwrapDek({ wrappedDek: wrapped, vaultKey, binding: envBinding })]).toStrictEqual([
      ...dek,
    ]);
  });

  it("an env DEK cannot be opened as a credentials DEK (even with the same key)", () => {
    const vaultKey = generateVaultKey();
    const envBinding: DekBinding = { ...binding, vaultKind: "env" };
    const wrapped = wrapDek({ dek: generateDek(), vaultKey, binding: envBinding });
    // Same orgId/credentialId/version/key — only the kind differs — still fails the tag.
    expect(() => unwrapDek({ wrappedDek: wrapped, vaultKey, binding })).toThrow(Error);
  });

  it("a separate env-vault key cannot open a credentials DEK (key-difference guard)", () => {
    const credKey = generateVaultKey();
    const envKey = generateVaultKey();
    const wrapped = wrapDek({ dek: generateDek(), vaultKey: credKey, binding });
    expect(() =>
      unwrapDek({
        wrappedDek: wrapped,
        vaultKey: envKey,
        binding: { ...binding, vaultKind: "env" },
      }),
    ).toThrow(Error);
  });

  it("opens a DEK sealed under the legacy pre-split AAD (back-compat)", () => {
    // Reconstruct a wrap exactly as the pre-split code did: the 3-part DEK AAD with
    // no kind segment. The new `unwrapDek` with `vaultKind: 'credentials'` MUST open
    // it, or every credential sealed before the split would become unreadable.
    const vaultKey = generateVaultKey();
    const dek = generateDek();
    const legacyAad = encodeAad("better-update/dek", [
      binding.orgId,
      binding.credentialId,
      binding.vaultVersion,
    ]);
    const legacyWrapped = aeadEncrypt(vaultKey, dek, legacyAad);
    expect([...unwrapDek({ wrappedDek: legacyWrapped, vaultKey, binding })]).toStrictEqual([
      ...dek,
    ]);
  });
});
