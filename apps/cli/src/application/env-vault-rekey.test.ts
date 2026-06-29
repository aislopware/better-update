import {
  generateDek,
  generateVaultKey,
  unwrapDek,
  wrapDek,
} from "@better-update/credentials-crypto";
import { fromBase64, toBase64 } from "@better-update/encoding";

import type { VaultKind } from "@better-update/credentials-crypto";

import { rekeyEnvDek } from "./env-vault-rekey";

const ORG_ID = "org-1";
const CREDENTIAL_ID = "env-rev-1";

/** Wrap a DEK under a vault key for a given binding, in the base64 wire form. */
const wrapped = (
  dek: Uint8Array,
  vaultKey: Uint8Array,
  vaultVersion: number,
  vaultKind: VaultKind,
): string =>
  toBase64(
    wrapDek({
      dek,
      vaultKey,
      binding: { orgId: ORG_ID, credentialId: CREDENTIAL_ID, vaultVersion, vaultKind },
    }),
  );

describe(rekeyEnvDek, () => {
  it("re-keys an env DEK from the credentials vault (cutover) to the env vault, preserving the DEK", () => {
    const cvKey = generateVaultKey();
    const evKey = generateVaultKey();
    const dek = generateDek();

    const update = rekeyEnvDek({
      orgId: ORG_ID,
      credentialId: CREDENTIAL_ID,
      wrappedDek: wrapped(dek, cvKey, 3, "credentials"),
      from: cvKey,
      fromVersion: 3,
      fromKind: "credentials",
      to: evKey,
      toVersion: 1,
      toKind: "env",
    });

    expect(update.credentialId).toBe(CREDENTIAL_ID);
    const recovered = unwrapDek({
      wrappedDek: fromBase64(update.wrappedDek),
      vaultKey: evKey,
      binding: { orgId: ORG_ID, credentialId: CREDENTIAL_ID, vaultVersion: 1, vaultKind: "env" },
    });
    expect(toBase64(recovered)).toBe(toBase64(dek));
  });

  it("a re-keyed env DEK no longer opens under the credentials key, nor with a credentials AAD", () => {
    const cvKey = generateVaultKey();
    const evKey = generateVaultKey();
    const dek = generateDek();

    const update = rekeyEnvDek({
      orgId: ORG_ID,
      credentialId: CREDENTIAL_ID,
      wrappedDek: wrapped(dek, cvKey, 3, "credentials"),
      from: cvKey,
      fromVersion: 3,
      fromKind: "credentials",
      to: evKey,
      toVersion: 1,
      toKind: "env",
    });

    // Wrong key (the credentials key the browser never gets) — AEAD tag fails.
    expect(() =>
      unwrapDek({
        wrappedDek: fromBase64(update.wrappedDek),
        vaultKey: cvKey,
        binding: { orgId: ORG_ID, credentialId: CREDENTIAL_ID, vaultVersion: 1, vaultKind: "env" },
      }),
    ).toThrow(Error);
    // Right key but the credentials AAD — the explicit vaultKind guard fails it.
    expect(() =>
      unwrapDek({
        wrappedDek: fromBase64(update.wrappedDek),
        vaultKey: evKey,
        binding: {
          orgId: ORG_ID,
          credentialId: CREDENTIAL_ID,
          vaultVersion: 1,
          vaultKind: "credentials",
        },
      }),
    ).toThrow(Error);
  });

  it("round-trips an env→env rotation (version bump)", () => {
    const evKeyV1 = generateVaultKey();
    const evKeyV2 = generateVaultKey();
    const dek = generateDek();

    const update = rekeyEnvDek({
      orgId: ORG_ID,
      credentialId: CREDENTIAL_ID,
      wrappedDek: wrapped(dek, evKeyV1, 1, "env"),
      from: evKeyV1,
      fromVersion: 1,
      fromKind: "env",
      to: evKeyV2,
      toVersion: 2,
      toKind: "env",
    });

    const recovered = unwrapDek({
      wrappedDek: fromBase64(update.wrappedDek),
      vaultKey: evKeyV2,
      binding: { orgId: ORG_ID, credentialId: CREDENTIAL_ID, vaultVersion: 2, vaultKind: "env" },
    });
    expect(toBase64(recovered)).toBe(toBase64(dek));
  });
});
