import { Effect } from "effect";

import {
  validateDistributionCertificateMetadata,
  validatePkcs12Blob,
} from "./apple-certificate-parser";

const VALID_META = {
  serialNumber: "DEADBEEF0000",
  appleTeamId: "ABCDE12345",
  validFrom: "2024-01-01T00:00:00Z",
  validUntil: "2026-01-01T00:00:00Z",
};

describe(validatePkcs12Blob, () => {
  test("accepts valid ASN.1 SEQUENCE blob", async () => {
    const bytes = new Uint8Array(64);
    bytes[0] = 0x30;
    const result = await Effect.runPromise(validatePkcs12Blob(bytes));
    expect(result.byteLength).toBe(64);
  });

  test("rejects too-small blob", async () => {
    const error = await Effect.runPromise(Effect.flip(validatePkcs12Blob(new Uint8Array(8))));
    expect(error.message).toMatch(/too small/);
  });

  test("rejects blob without SEQUENCE tag", async () => {
    const bytes = new Uint8Array(64);
    bytes[0] = 0x00;
    const error = await Effect.runPromise(Effect.flip(validatePkcs12Blob(bytes)));
    expect(error.message).toMatch(/SEQUENCE/);
  });
});

describe(validateDistributionCertificateMetadata, () => {
  test("accepts valid metadata", async () => {
    const result = await Effect.runPromise(validateDistributionCertificateMetadata(VALID_META));
    expect(result.appleTeamId).toBe("ABCDE12345");
    expect(result.appleTeamName).toBeNull();
  });

  test("rejects bad team id", async () => {
    const error = await Effect.runPromise(
      Effect.flip(validateDistributionCertificateMetadata({ ...VALID_META, appleTeamId: "bad" })),
    );
    expect(error.message).toMatch(/Team identifier/);
  });

  test("rejects empty serial", async () => {
    const error = await Effect.runPromise(
      Effect.flip(validateDistributionCertificateMetadata({ ...VALID_META, serialNumber: "  " })),
    );
    expect(error.message).toMatch(/serial/);
  });

  test("rejects non-ISO dates", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        validateDistributionCertificateMetadata({ ...VALID_META, validFrom: "not-a-date" }),
      ),
    );
    expect(error.message).toMatch(/ISO/);
  });

  test("rejects validUntil <= validFrom", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        validateDistributionCertificateMetadata({
          ...VALID_META,
          validFrom: "2026-01-01T00:00:00Z",
          validUntil: "2024-01-01T00:00:00Z",
        }),
      ),
    );
    expect(error.message).toMatch(/precede/);
  });
});
