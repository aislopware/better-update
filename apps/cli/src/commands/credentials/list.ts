import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { isoDate } from "../../lib/credential-choices";
import { filterCredentials, listAllCredentials } from "../../lib/credentials-manager";
import { printList } from "../../lib/output";
import { apiClient } from "../../services/api-client";

export const listCommand = defineCommand({
  meta: { name: "list", description: "List credentials across platforms" },
  args: {
    platform: { type: "enum", options: ["ios", "android"], description: "Filter by platform" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const rows = yield* listAllCredentials(api);

        const filtered = filterCredentials(rows, args.platform ? { platform: args.platform } : {});

        // "Name" is the user-supplied `--name`; "Identifier" is the credential's
        // own id (keystore key alias, cert serial, …). They were collapsed into a
        // single "Name" column before, which hid the label that disambiguates
        // white-label keystores reusing the same alias. SHA-1 lets a keystore be
        // matched against the Play Console upload-key certificate.
        yield* printList(
          ["ID", "Name", "Identifier", "Platform", "Type", "Created", "SHA-1"],
          filtered.map((row) => [
            row.id,
            row.name ?? "-",
            row.identifier,
            row.platform,
            row.type,
            isoDate(row.createdAt),
            row.sha1Fingerprint ?? "-",
          ]),
          "No credentials found.",
        );
      }),
    ),
});
