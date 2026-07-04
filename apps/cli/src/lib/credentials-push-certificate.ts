import { toBase64 } from "@better-update/encoding";
import { Effect } from "effect";

import {
  openVaultSessionInteractive,
  sealForUpload,
  toUploadEnvelope,
} from "../application/credential-cipher";
import { CredentialValidationError } from "./exit-codes";
import { inspectP12 } from "./pkcs12";
import { autoBindProjectId } from "./project-link";

import type { ApiClient } from "../services/api-client";
import type { UploadCredentialInput } from "./credentials-manager";

/**
 * Derive the App ID a push SSL cert is bound to from its Common Name, e.g.
 * "Apple Push Services: com.example.app" → "com.example.app". Returns undefined
 * when the CN does not carry a reverse-DNS identifier.
 */
const bundleIdFromPushCertCN = (commonName: string): string | undefined => {
  const match = /:\s*(?<bundle>[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)\s*$/u.exec(commonName);
  const bundle = match?.groups?.["bundle"];
  return bundle?.includes(".") ? bundle : undefined;
};

/**
 * Manual upload of a legacy APNs Push Services `.p12` SSL certificate. The CLI
 * parses the cert locally for its metadata (serial, validity, team, and the App
 * ID from the CN) and seals `{ p12Base64, p12Password }` into the vault; the
 * server only ever stores the ciphertext.
 */
export const uploadIosPushCertificate = (
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
    const bundleIdentifier = input.bundleIdentifier ?? bundleIdFromPushCertCN(info.signingIdentity);
    if (!bundleIdentifier) {
      return yield* new CredentialValidationError({
        message:
          "Could not derive the App ID from the push certificate (expected CN 'Apple Push Services: <bundle id>'). Pass --bundle-identifier.",
      });
    }
    const metadata = {
      bundleIdentifier,
      serialNumber: info.serialNumber,
      appleTeamIdentifier: info.teamId,
      validFrom: info.validFrom.toISOString(),
      validUntil: info.expiresAt.toISOString(),
    };
    const session = yield* openVaultSessionInteractive(api);
    const envelope = yield* sealForUpload({
      session,
      credentialType: "push-certificate",
      metadata,
      secret: { p12Base64: toBase64(bytes), p12Password: input.password },
    });
    const created = yield* api.applePushCertificates.upload({
      payload: { ...toUploadEnvelope(envelope), ...metadata, ...(yield* autoBindProjectId) },
    });
    return {
      id: created.id,
      name: input.name,
      platform: "ios" as const,
      type: "push-certificate" as const,
    };
  });
