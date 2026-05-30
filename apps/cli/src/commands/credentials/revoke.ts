import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { revokeLocalDistributionCertificate } from "../../lib/credentials-generator";
import { CredentialValidationError } from "../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { promptSelect } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";

import type { ApiClient } from "../../services/api-client";

const REVOKE_EXIT_EXTRAS = {
  CredentialValidationError: 2,
  GenerateFailedError: 6,
} as const;

const resolveAscKeyId = (api: ApiClient, raw: string | undefined) =>
  Effect.gen(function* () {
    if (raw !== undefined && raw.length > 0) {
      return raw;
    }
    const keys = yield* api.ascApiKeys.list();
    if (keys.items.length === 0) {
      return yield* new CredentialValidationError({
        message: "No ASC API keys available. Upload one with `credentials upload-asc-key` first.",
      });
    }
    if (keys.items.length === 1) {
      const [only] = keys.items;
      if (only !== undefined) {
        return only.id;
      }
    }
    return yield* promptSelect<string>(
      "Select an ASC API key to revoke with",
      keys.items.map((key) => ({ value: key.id, label: `${key.name} (${key.keyId})` })),
    );
  });

const distributionCertificateCommand = defineCommand({
  meta: {
    name: "distribution-certificate",
    description:
      "Revoke an iOS distribution certificate on the Apple Developer Portal and delete it from this account",
  },
  args: {
    id: { type: "string", required: true, description: "Local distribution certificate ID" },
    "asc-key-id": {
      type: "string",
      description: "ASC API key ID (prompts if omitted and multiple keys exist)",
    },
    "keep-local": {
      type: "boolean",
      description: "Revoke on Apple but keep the credential in this account",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const ascApiKeyId = yield* resolveAscKeyId(api, args["asc-key-id"]);
        const result = yield* revokeLocalDistributionCertificate(api, {
          ascApiKeyId,
          distributionCertificateId: args.id,
          keepLocal: args["keep-local"] ?? false,
        });
        yield* printHuman("Distribution certificate revoke complete.");
        yield* printHumanKeyValue([
          ["Local ID", result.localId],
          ["Serial", result.serialNumber],
          ["Revoked on Apple", result.revokedOnApple ? "yes" : "no (not present on portal)"],
          ["Deleted locally", result.deletedLocally ? "yes" : "no (--keep-local)"],
        ]);
        return result;
      }),
      { exits: REVOKE_EXIT_EXTRAS, json: "value" },
    ),
});

export const revokeCommand = defineCommand({
  meta: { name: "revoke", description: "Revoke credentials on the upstream provider" },
  subCommands: {
    "distribution-certificate": distributionCertificateCommand,
  },
});
