import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { uploadCredential } from "../../lib/credentials-manager";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";

import type { CliCredentialType } from "../../lib/credentials-manager";

const CREDENTIAL_TYPES = [
  "distribution-certificate",
  "provisioning-profile",
  "push-key",
  "asc-api-key",
  "keystore",
  "google-service-account-key",
] as const;

export const uploadCommand = defineCommand({
  meta: { name: "upload", description: "Upload a credential" },
  args: {
    platform: { type: "enum", options: ["ios", "android"], required: true },
    type: { type: "enum", options: [...CREDENTIAL_TYPES], required: true },
    name: { type: "string", required: true, description: "Display name" },
    file: { type: "string", required: true, description: "Path to credential file" },
    password: { type: "string", description: "File password (keystore/p12)" },
    "key-alias": { type: "string", description: "Keystore alias" },
    "key-password": { type: "string", description: "Keystore key password" },
    "key-id": { type: "string", description: "ASC API key ID" },
    "issuer-id": { type: "string", description: "ASC API issuer ID" },
    "apple-team-identifier": { type: "string", description: "Apple Team ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;

        const input = {
          platform: args.platform,
          type: args.type as CliCredentialType,
          name: args.name,
          filePath: args.file,
          ...compact({
            password: args.password,
            keyAlias: args["key-alias"],
            keyPassword: args["key-password"],
            keyId: args["key-id"],
            issuerId: args["issuer-id"],
            appleTeamIdentifier: args["apple-team-identifier"],
          }),
        };

        const credential = yield* uploadCredential(api, input);

        yield* printHuman("Credential uploaded successfully.");
        yield* printHuman("");
        yield* printHumanKeyValue([
          ["ID", credential.id],
          ["Name", credential.name],
          ["Platform", credential.platform],
          ["Type", credential.type],
        ]);
        return credential;
      }),
      { json: "value" },
    ),
});
