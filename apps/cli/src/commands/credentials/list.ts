import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { APPLE_CERTIFICATE_TYPE_LABELS } from "../../lib/apple-certificate-type";
import { isoDate } from "../../lib/credential-choices";
import { filterCredentials, listAllCredentials } from "../../lib/credentials-manager";
import { printList } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

import type { CliCredentialType } from "../../lib/credentials-manager";

const CREDENTIAL_TYPES = [
  "distribution-certificate",
  "macos-certificate",
  "provisioning-profile",
  "push-key",
  "push-certificate",
  "apple-pay-certificate",
  "pass-type-certificate",
  "asc-api-key",
  "keystore",
  "google-service-account-key",
] as const satisfies readonly CliCredentialType[];

export const listCommand = Command.make(
  "list",
  {
    platform: Flag.Literals("platform", ["ios", "android", "macos"]).pipe(
      Flag.withDescription("Filter by platform"),
      optionalFlag,
    ),
    type: Flag.Literals("type", [...CREDENTIAL_TYPES]).pipe(
      Flag.withDescription("Filter by credential type"),
      optionalFlag,
    ),
  },
  Effect.fn(function* (args) {
    const api = yield* apiClient;
    const rows = yield* listAllCredentials(api);

    const filtered = filterCredentials(rows, {
      ...(args.platform ? { platform: args.platform } : {}),
      ...(args.type ? { type: args.type } : {}),
    });

    // "Name" is the user-supplied `--name`; "Identifier" is the credential's
    // own id (keystore key alias, cert serial, …). They were collapsed into a
    // single "Name" column before, which hid the label that disambiguates
    // white-label keystores reusing the same alias. SHA-1 lets a keystore be
    // matched against the Play Console upload-key certificate. "Cert type" is
    // the Apple certificate kind, which is what tells a Developer ID
    // Application certificate from a Developer ID Installer one.
    yield* printList(
      ["ID", "Name", "Identifier", "Platform", "Type", "Cert type", "Created", "SHA-1"],
      filtered.map((row) => [
        row.id,
        row.name ?? "-",
        row.identifier,
        row.platform,
        row.type,
        row.certificateType === null ? "-" : APPLE_CERTIFICATE_TYPE_LABELS[row.certificateType],
        isoDate(row.createdAt),
        row.sha1Fingerprint ?? "-",
      ]),
      "No credentials found.",
    );
  }, runCommand()),
).pipe(Command.withDescription("List credentials across platforms"));
