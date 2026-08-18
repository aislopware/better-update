import { toBase64 } from "@better-update/encoding";
import { compact } from "@better-update/type-guards";
import { Effect } from "effect";

import {
  openVaultSessionInteractive,
  sealForUpload,
  toUploadEnvelope,
} from "../application/credential-cipher";
import { isMacosCertificateType } from "./apple-certificate-type";
import { CredentialValidationError } from "./exit-codes";
import { inspectP12 } from "./pkcs12";
import { autoBindProjectId } from "./project-link";

import type { ApiClient } from "../services/api-client";
import type { UploadCredentialInput } from "./credentials-manager";

/**
 * Upload an Apple signing `.p12`. Both `ios:distribution-certificate` and
 * `macos:macos-certificate` land here — the file is the same format and goes to
 * the same endpoint — but the certificate is classified from its own subject
 * and a mismatch with the requested type is an error rather than a silent
 * mis-file: uploading a Developer ID cert as an iOS one used to store it with
 * no way for `macos sign` to find it again.
 */
export const uploadAppleCertificate =
  (expect: "ios" | "macos") => (api: ApiClient, input: UploadCredentialInput, bytes: Uint8Array) =>
    Effect.gen(function* () {
      if (input.password === undefined) {
        return yield* new CredentialValidationError({
          message: "Missing --password required for the selected credential type.",
        });
      }
      const info = yield* inspectP12({ data: Buffer.from(bytes), password: input.password });
      if (!info.teamId) {
        return yield* new CredentialValidationError({
          message:
            "Could not derive Apple Team ID from certificate subject (expected OU=TEAMID or CN with (TEAMID)).",
        });
      }
      if (!info.validFrom || !info.expiresAt) {
        return yield* new CredentialValidationError({
          message: "Certificate is missing notBefore/notAfter dates.",
        });
      }
      const isMacos = isMacosCertificateType(info.certificateType);
      if (isMacos !== (expect === "macos")) {
        return yield* new CredentialValidationError({
          message: isMacos
            ? `"${info.signingIdentity}" is a macOS ${info.certificateType} certificate — upload it with --platform macos --type macos-certificate.`
            : `"${info.signingIdentity}" is an iOS ${info.certificateType} certificate — upload it with --platform ios --type distribution-certificate.`,
        });
      }
      const metadata = compact({
        serialNumber: info.serialNumber,
        certificateType: info.certificateType,
        appleTeamIdentifier: info.teamId,
        developerIdIdentifier: info.developerIdIdentifier,
        validFrom: info.validFrom.toISOString(),
        validUntil: info.expiresAt.toISOString(),
      });
      const session = yield* openVaultSessionInteractive(api);
      const envelope = yield* sealForUpload({
        session,
        credentialType: "distribution-certificate",
        metadata,
        secret: { p12Base64: toBase64(bytes), p12Password: input.password },
      });
      const created = yield* api.appleDistributionCertificates.upload({
        payload: { ...toUploadEnvelope(envelope), ...metadata, ...(yield* autoBindProjectId) },
      });
      return {
        id: created.id,
        name: input.name,
        platform: isMacos ? ("macos" as const) : ("ios" as const),
        type: isMacos ? ("macos-certificate" as const) : ("distribution-certificate" as const),
      };
    });
