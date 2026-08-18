/**
 * Developer ID Application certificate resolution for `macos sign`: pick the
 * stored cert (flag › lone match › interactive picker), then download + decrypt
 * its `.p12` locally. Candidates are the rows whose stored `certificateType` is
 * `DEVELOPER_ID_APPLICATION` (mig 0101) — before that column existed this had
 * to guess from a non-null `developerIdIdentifier`, which missed every
 * certificate uploaded rather than generated.
 */
import { fromBase64 } from "@better-update/encoding";
import { Effect } from "effect";

import { makeAppleTeamLabeler } from "../lib/credential-choices";
import { requireSecretString } from "../lib/credential-secret";
import { CredentialValidationError, IdentityError } from "../lib/exit-codes";
import { printHuman } from "../lib/output";
import { promptSelect } from "../lib/prompts";
import { openFromDownload, openVaultSessionInteractive } from "./credential-cipher";

import type { ApiClient } from "../services/api-client";

const GENERATE_HINT =
  "Create one with `better-update credentials generate distribution-certificate --type developer-id` (Apple only issues these to the team's Account Holder), or upload an exported .p12 with `better-update credentials upload --platform macos --type macos-certificate`.";

/**
 * Resolve which stored Developer ID Application certificate to sign with:
 * `--certificate-id` wins; a lone stored cert is used with a printed note; more
 * than one opens a team-labeled picker (which fails with guidance when
 * non-interactive).
 *
 * The flag is checked against the same candidate set rather than trusted: an id
 * copied out of `credentials list` can just as easily be an App Store
 * certificate, and codesign's complaint about it names neither the flag nor the
 * certificate kind.
 */
export const resolveDeveloperIdCertificateId = (api: ApiClient, flagCertId: string | undefined) =>
  Effect.gen(function* () {
    const listing = yield* api.appleDistributionCertificates.list();
    const candidates = listing.items.filter(
      (cert) => cert.certificateType === "DEVELOPER_ID_APPLICATION",
    );
    if (flagCertId !== undefined && flagCertId.length > 0) {
      const flagged = candidates.find((cert) => cert.id === flagCertId);
      if (flagged === undefined) {
        const stored = listing.items.find((cert) => cert.id === flagCertId);
        return yield* new CredentialValidationError({
          message:
            stored === undefined
              ? `Certificate ${flagCertId} is not stored for this organization.`
              : `Certificate ${flagCertId} is a ${stored.certificateType} certificate; signing a macOS app needs a Developer ID Application certificate.`,
        });
      }
      return flagged.id;
    }
    if (candidates.length === 0) {
      return yield* new CredentialValidationError({
        message: `No Developer ID Application certificate stored for this organization. ${GENERATE_HINT}`,
      });
    }
    const teamLabel = makeAppleTeamLabeler((yield* api.appleTeams.list()).items);
    const label = (cert: (typeof candidates)[number]): string =>
      `${cert.developerIdIdentifier ?? cert.serialNumber} — ${teamLabel(cert.appleTeamId)}, serial ${cert.serialNumber.slice(0, 12)}…, valid until ${cert.validUntil.slice(0, 10)}`;
    const [lone] = candidates;
    if (candidates.length === 1 && lone !== undefined) {
      yield* printHuman(`Using stored Developer ID certificate: ${label(lone)}`);
      return lone.id;
    }
    return yield* promptSelect<string>(
      "Which Developer ID certificate should sign this app?",
      candidates.map((cert) => ({ value: cert.id, label: label(cert) })),
    );
  });

export interface DeveloperIdP12 {
  readonly p12Bytes: Uint8Array;
  readonly p12Password: string;
  readonly serialNumber: string;
  readonly appleTeamIdentifier: string;
}

/**
 * Download the certificate's encrypted envelope and decrypt the `.p12` + its
 * password locally (the server is zero-knowledge for vault credentials).
 */
export const fetchDeveloperIdP12 = (api: ApiClient, certificateId: string) =>
  Effect.gen(function* () {
    const data = yield* api.appleDistributionCertificates.download({
      path: { id: certificateId },
    });
    const session = yield* openVaultSessionInteractive(api);
    const secret = yield* openFromDownload({
      session,
      credentialType: "distribution-certificate",
      downloaded: data,
    });
    const secretField = (key: string) =>
      requireSecretString(
        secret,
        key,
        (field) =>
          new IdentityError({
            message: `Decrypted distribution certificate is missing the "${field}" field.`,
          }),
      );
    const p12Base64 = yield* secretField("p12Base64");
    const p12Password = yield* secretField("p12Password");
    return {
      p12Bytes: fromBase64(p12Base64),
      p12Password,
      serialNumber: data.serialNumber,
      appleTeamIdentifier: data.appleTeamIdentifier,
    } satisfies DeveloperIdP12;
  });
