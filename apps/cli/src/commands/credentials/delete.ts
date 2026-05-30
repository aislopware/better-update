import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { deleteCredential } from "../../lib/credentials-manager";
import { printHuman } from "../../lib/output";
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

export const deleteCommand = defineCommand({
  meta: { name: "delete", description: "Delete a credential" },
  args: {
    id: { type: "positional", required: true, description: "Credential ID" },
    platform: { type: "enum", options: ["ios", "android"], required: true },
    type: { type: "enum", options: [...CREDENTIAL_TYPES], required: true },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        yield* deleteCredential(api, {
          id: args.id,
          platform: args.platform,
          type: args.type as CliCredentialType,
        });
        yield* printHuman(`Credential ${args.id} deleted.`);
        return { id: args.id, platform: args.platform, type: args.type, deleted: true };
      }),
      { json: "value" },
    ),
});
