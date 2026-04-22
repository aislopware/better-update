import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { uploadCredential } from "../../lib/credentials-manager";
import { printKeyValue } from "../../lib/output";
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

        const input: {
          readonly platform: "ios" | "android";
          readonly type: CliCredentialType;
          readonly name: string;
          readonly filePath: string;
          readonly password?: string;
          readonly keyAlias?: string;
          readonly keyPassword?: string;
          readonly keyId?: string;
          readonly issuerId?: string;
          readonly appleTeamIdentifier?: string;
        } = {
          platform: args.platform,
          type: args.type as CliCredentialType,
          name: args.name,
          filePath: args.file,
          ...(args.password === undefined ? {} : { password: args.password }),
          ...(args["key-alias"] === undefined ? {} : { keyAlias: args["key-alias"] }),
          ...(args["key-password"] === undefined ? {} : { keyPassword: args["key-password"] }),
          ...(args["key-id"] === undefined ? {} : { keyId: args["key-id"] }),
          ...(args["issuer-id"] === undefined ? {} : { issuerId: args["issuer-id"] }),
          ...(args["apple-team-identifier"] === undefined
            ? {}
            : { appleTeamIdentifier: args["apple-team-identifier"] }),
        };

        const credential = yield* uploadCredential(api, input);

        yield* Console.log("Credential uploaded successfully.");
        yield* Console.log("");
        yield* printKeyValue([
          ["ID", credential.id],
          ["Name", credential.name],
          ["Platform", credential.platform],
          ["Type", credential.type],
        ]);
      }),
    ),
});
