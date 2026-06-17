import { toBase64 } from "@better-update/encoding";
import { Effect } from "effect";

import {
  openVaultSessionInteractive,
  sealForUpload,
  toUploadEnvelope,
} from "../application/credential-cipher";
import { CredentialValidationError } from "./exit-codes";
import { inspectP12 } from "./pkcs12";

import type { ApiClient } from "../services/api-client";
import type { UploadCredentialInput } from "./credentials-manager";

/**
 * Manual upload of a Wallet Pass Type ID `.p12` certificate. The Pass Type ID
 * (`pass.*`) is passed explicitly; serial/validity come from the parsed cert and
 * the team from its OU (or `--apple-team-identifier`). Only
 * `{ p12Base64, p12Password }` is sealed.
 */
export const uploadIosPassTypeCertificate = (
  api: ApiClient,
  input: UploadCredentialInput,
  bytes: Uint8Array,
) =>
  Effect.gen(function* () {
    if (input.password === undefined) {
      return yield* new CredentialValidationError({
        message: "Missing --password required for the selected credential type.",
      });
    }
    if (!input.passTypeIdentifier) {
      return yield* new CredentialValidationError({
        message: "Missing --pass-type-identifier required for a Pass Type ID certificate.",
      });
    }
    const info = yield* inspectP12({ data: Buffer.from(bytes), password: input.password });
    const appleTeamIdentifier = info.teamId ?? input.appleTeamIdentifier;
    if (!appleTeamIdentifier) {
      return yield* new CredentialValidationError({
        message:
          "Could not derive Apple Team ID from the certificate; pass --apple-team-identifier.",
      });
    }
    if (!info.validFrom || !info.expiresAt) {
      return yield* new CredentialValidationError({
        message: "Certificate is missing notBefore/notAfter dates.",
      });
    }
    const metadata = {
      passTypeIdentifier: input.passTypeIdentifier,
      serialNumber: info.serialNumber,
      appleTeamIdentifier,
      validFrom: info.validFrom.toISOString(),
      validUntil: info.expiresAt.toISOString(),
    };
    const session = yield* openVaultSessionInteractive(api);
    const envelope = yield* sealForUpload({
      session,
      credentialType: "pass-type-certificate",
      metadata,
      secret: { p12Base64: toBase64(bytes), p12Password: input.password },
    });
    const created = yield* api.applePassTypeCertificates.upload({
      payload: { ...toUploadEnvelope(envelope), ...metadata },
    });
    return {
      id: created.id,
      name: input.name,
      platform: "ios" as const,
      type: "pass-type-certificate" as const,
    };
  });
