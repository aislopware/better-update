/// <reference types="vitest/globals" />

import { SCHEMA_VERSION, generateDek, openCredential, sealCredential } from "./index";

import type { CredentialBinding, CredentialPayload } from "./index";

const makePayload = (over: Partial<CredentialPayload> = {}): CredentialPayload => ({
  schemaVersion: SCHEMA_VERSION,
  orgId: "org_1",
  credentialId: "cred_1",
  credentialType: "ios_distribution_certificate",
  metadata: { serial: "ABC123", teamId: "TEAM1234" },
  secret: { p12: "ZmFrZS1wMTItYnl0ZXM=", password: "hunter2" },
  ...over,
});

const bindingOf = (payload: CredentialPayload): CredentialBinding => ({
  schemaVersion: payload.schemaVersion,
  orgId: payload.orgId,
  credentialId: payload.credentialId,
  credentialType: payload.credentialType,
});

describe("credential blob sealing", () => {
  it("seals and opens a round-trip, recovering metadata and secret", () => {
    const dek = generateDek();
    const payload = makePayload();
    const ciphertext = sealCredential({ dek, payload });
    expect(openCredential({ dek, ciphertext, expect: bindingOf(payload) })).toStrictEqual(payload);
  });

  it("rejects a mismatched binding (cross-credential blob swap)", () => {
    const dek = generateDek();
    const payload = makePayload();
    const ciphertext = sealCredential({ dek, payload });
    expect(() =>
      openCredential({
        dek,
        ciphertext,
        expect: { ...bindingOf(payload), credentialId: "cred_2" },
      }),
    ).toThrow(Error);
  });

  it("rejects a wrong credential type even with the right ids", () => {
    const dek = generateDek();
    const payload = makePayload();
    const ciphertext = sealCredential({ dek, payload });
    expect(() =>
      openCredential({
        dek,
        ciphertext,
        expect: { ...bindingOf(payload), credentialType: "apple_push_key" },
      }),
    ).toThrow(Error);
  });

  it("rejects a different DEK", () => {
    const payload = makePayload();
    const ciphertext = sealCredential({ dek: generateDek(), payload });
    expect(() =>
      openCredential({ dek: generateDek(), ciphertext, expect: bindingOf(payload) }),
    ).toThrow(Error);
  });
});
