import { Effect } from "effect";

import { validateAscApiKey } from "./asc-api-key-validator";

const VALID_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgqIOEeXH1hSPYy+1c
-----END PRIVATE KEY-----`;

const VALID = {
  keyId: "ABCDE12345",
  issuerId: "12345678-abcd-ef12-3456-7890abcdef12",
  name: "Primary",
  pem: VALID_PEM,
};

describe(validateAscApiKey, () => {
  it("accepts valid metadata without team", async () => {
    const result = await Effect.runPromise(validateAscApiKey(VALID));
    expect(result.keyId).toBe("ABCDE12345");
    expect(result.appleTeamId).toBeNull();
    expect(result.roles).toStrictEqual([]);
  });

  it("accepts optional team + roles", async () => {
    const result = await Effect.runPromise(
      validateAscApiKey({ ...VALID, appleTeamId: "FGHIJ67890", roles: ["ADMIN"] }),
    );
    expect(result.appleTeamId).toBe("FGHIJ67890");
    expect(result.roles).toStrictEqual(["ADMIN"]);
  });

  it("rejects bad keyId", async () => {
    const error = await Effect.runPromise(
      Effect.flip(validateAscApiKey({ ...VALID, keyId: "bad" })),
    );
    expect(error.message).toMatch(/ASC API Key ID/);
  });

  it("rejects bad issuerId", async () => {
    const error = await Effect.runPromise(
      Effect.flip(validateAscApiKey({ ...VALID, issuerId: "not-uuid" })),
    );
    expect(error.message).toMatch(/Issuer ID/);
  });

  it("rejects empty name", async () => {
    const error = await Effect.runPromise(Effect.flip(validateAscApiKey({ ...VALID, name: " " })));
    expect(error.message).toMatch(/Name must be/);
  });

  it("rejects bad team identifier when provided", async () => {
    const error = await Effect.runPromise(
      Effect.flip(validateAscApiKey({ ...VALID, appleTeamId: "lower12345" })),
    );
    expect(error.message).toMatch(/Team identifier/);
  });

  it("rejects invalid PEM", async () => {
    const error = await Effect.runPromise(Effect.flip(validateAscApiKey({ ...VALID, pem: "x" })));
    expect(error.message).toMatch(/PKCS8 PEM/);
  });
});
