import { Data, Effect } from "effect";

import { toDbNull } from "../lib/nullable";
import { APPLE_TEAM_ID_PATTERN } from "./apple-identifiers";

export class InvalidAppleCertificate extends Data.TaggedError("InvalidAppleCertificate")<{
  readonly message: string;
}> {}

export interface ParsedDistributionCertificate {
  readonly serialNumber: string;
  readonly developerIdIdentifier: string | null;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly appleTeamId: string;
  readonly appleTeamName: string | null;
}

export interface DistributionCertificateMetadata {
  readonly serialNumber: string;
  readonly appleTeamId: string;
  readonly appleTeamName?: string;
  readonly developerIdIdentifier?: string;
  readonly validFrom: string;
  readonly validUntil: string;
}

const PKCS12_MIN_BYTES = 32;

// Known limitation: this is a shape check, not structural validation. Full PKCS#12
// Parsing (serial / team identifier / validity) is performed client-side in the
// CLI via node-forge and submitted as metadata. A server-side WASM PKCS#12 parser
// Is on the roadmap so uploaded metadata can be verified against the blob.
export const validatePkcs12Blob = (bytes: Uint8Array) =>
  Effect.gen(function* () {
    if (bytes.byteLength < PKCS12_MIN_BYTES) {
      return yield* Effect.fail(new InvalidAppleCertificate({ message: "PKCS12 blob too small" }));
    }
    if (bytes[0] !== 0x30) {
      return yield* Effect.fail(
        new InvalidAppleCertificate({
          message: "PKCS12 must start with ASN.1 SEQUENCE tag (0x30)",
        }),
      );
    }
    return bytes;
  });

const isIsoDate = (value: string) => {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
};

export const validateDistributionCertificateMetadata = (
  metadata: DistributionCertificateMetadata,
) =>
  Effect.gen(function* () {
    if (!APPLE_TEAM_ID_PATTERN.test(metadata.appleTeamId)) {
      return yield* Effect.fail(
        new InvalidAppleCertificate({
          message: "Apple Team identifier must be 10 uppercase alphanumeric characters",
        }),
      );
    }
    if (metadata.serialNumber.trim().length === 0) {
      return yield* Effect.fail(
        new InvalidAppleCertificate({ message: "Certificate serial number is required" }),
      );
    }
    if (!isIsoDate(metadata.validFrom) || !isIsoDate(metadata.validUntil)) {
      return yield* Effect.fail(
        new InvalidAppleCertificate({ message: "Certificate validity dates must be ISO strings" }),
      );
    }
    if (new Date(metadata.validUntil).getTime() <= new Date(metadata.validFrom).getTime()) {
      return yield* Effect.fail(
        new InvalidAppleCertificate({
          message: "Certificate validFrom must precede validUntil",
        }),
      );
    }
    const parsed: ParsedDistributionCertificate = {
      serialNumber: metadata.serialNumber,
      developerIdIdentifier: toDbNull(metadata.developerIdIdentifier),
      validFrom: metadata.validFrom,
      validUntil: metadata.validUntil,
      appleTeamId: metadata.appleTeamId,
      appleTeamName: toDbNull(metadata.appleTeamName),
    };
    return parsed;
  });
