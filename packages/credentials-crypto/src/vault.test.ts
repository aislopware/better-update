/// <reference types="vitest/globals" />

import {
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
  const binding: DekBinding = { orgId: "org_1", credentialId: "cred_1", vaultVersion: 1 };

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
  ])("rejects a mismatched binding %o", (wrongBinding) => {
    const vaultKey = generateVaultKey();
    const wrapped = wrapDek({ dek: generateDek(), vaultKey, binding });
    expect(() => unwrapDek({ wrappedDek: wrapped, vaultKey, binding: wrongBinding })).toThrow(
      Error,
    );
  });
});
