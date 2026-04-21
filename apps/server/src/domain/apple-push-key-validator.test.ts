import { Effect } from "effect";

import { validatePushKey } from "./apple-push-key-validator";

const VALID_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgqIOEeXH1hSPYy+1c
-----END PRIVATE KEY-----`;

describe(validatePushKey, () => {
  it("accepts valid metadata", async () => {
    const result = await Effect.runPromise(
      validatePushKey({ keyId: "ABCDE12345", appleTeamId: "FGHIJ67890", pem: VALID_PEM }),
    );
    expect(result.keyId).toBe("ABCDE12345");
    expect(result.appleTeamId).toBe("FGHIJ67890");
    expect(result.derBytes.byteLength).toBeGreaterThan(0);
  });

  it("rejects invalid keyId", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        validatePushKey({ keyId: "lower12345", appleTeamId: "FGHIJ67890", pem: VALID_PEM }),
      ),
    );
    expect(error.message).toMatch(/Push Key ID/);
  });

  it("rejects invalid appleTeamId", async () => {
    const error = await Effect.runPromise(
      Effect.flip(validatePushKey({ keyId: "ABCDE12345", appleTeamId: "bad", pem: VALID_PEM })),
    );
    expect(error.message).toMatch(/Team identifier/);
  });

  it("rejects non-PEM", async () => {
    const error = await Effect.runPromise(
      Effect.flip(validatePushKey({ keyId: "ABCDE12345", appleTeamId: "FGHIJ67890", pem: "nope" })),
    );
    expect(error.message).toMatch(/PKCS8 PEM/);
  });
});
