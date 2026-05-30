import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { uploadCredential } from "../../lib/credentials-manager";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { promptText } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";

export const uploadAscKeyCommand = defineCommand({
  meta: {
    name: "upload-asc-key",
    description:
      "Upload an App Store Connect API key (.p8) so the CLI can issue certificates + sync devices",
  },
  args: {
    p8: { type: "string", required: true, description: "Path to the AuthKey_XXXXXXXXXX.p8 file" },
    "key-id": { type: "string", description: "ASC key ID (10 uppercase alphanumeric)" },
    "issuer-id": { type: "string", description: "ASC issuer ID (UUID)" },
    "apple-team-identifier": {
      type: "string",
      description: "Apple Team identifier (optional, derived from token at first use)",
    },
    name: { type: "string", description: "Display name (defaults to the key ID)" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const keyId =
          args["key-id"] ?? (yield* promptText("ASC key ID (10 uppercase alphanumeric)"));
        const issuerId = args["issuer-id"] ?? (yield* promptText("ASC issuer ID (UUID)"));
        const name = args.name ?? keyId;
        const credential = yield* uploadCredential(api, {
          platform: "ios",
          type: "asc-api-key",
          name,
          filePath: args.p8,
          keyId,
          issuerId,
          ...compact({ appleTeamIdentifier: args["apple-team-identifier"] }),
        });
        yield* printHuman("ASC API key uploaded.");
        yield* printHumanKeyValue([
          ["ID", credential.id],
          ["Name", credential.name],
          ["Type", credential.type],
        ]);
        return credential;
      }),
      { json: "value" },
    ),
});
