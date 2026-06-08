import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { revokeLocalDistributionCertificate } from "../../lib/credentials-generator";
import { revokeLocalApnsKey } from "../../lib/credentials-generator-apple-id";
import { CredentialValidationError } from "../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { promptSelect } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";
import { AppleAuth } from "../../services/apple-auth";

import type { ApiClient } from "../../services/api-client";

const REVOKE_EXIT_EXTRAS = {
  CredentialValidationError: 2,
  GenerateFailedError: 6,
  AppleIdGenerateFailedError: 6,
  AppleAuthError: 4,
  InteractiveProhibitedError: 4,
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

const resolvePushKeyTarget = (api: ApiClient, idArg: string | undefined) =>
  Effect.gen(function* () {
    const { items } = yield* api.applePushKeys.list();
    if (items.length === 0) {
      return yield* new CredentialValidationError({
        message: "No APNs push keys stored. Nothing to revoke.",
      });
    }
    if (idArg !== undefined && idArg.length > 0) {
      const match = items.find((entry) => entry.id === idArg);
      if (match === undefined) {
        return yield* new CredentialValidationError({ message: `Push key ${idArg} not found.` });
      }
      return match;
    }
    if (items.length === 1) {
      const [only] = items;
      if (only !== undefined) {
        return only;
      }
    }
    const chosen = yield* promptSelect<string>(
      "Select a push key to revoke",
      items.map((entry) => ({
        value: entry.id,
        label: `${entry.keyId} (team ${entry.appleTeamId})`,
      })),
    );
    const match = items.find((entry) => entry.id === chosen);
    if (match === undefined) {
      return yield* new CredentialValidationError({
        message: `Selected push key ${chosen} not found after listing.`,
      });
    }
    return match;
  });

const pushKeyCommand = defineCommand({
  meta: {
    name: "push-key",
    description:
      "Revoke an APNs auth key on the Apple Developer Portal (via Apple ID login) and delete it from this account",
  },
  args: {
    id: { type: "string", description: "Local push key ID (prompts if omitted)" },
    "keep-local": {
      type: "boolean",
      description: "Revoke on Apple but keep the credential in this account",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const target = yield* resolvePushKeyTarget(api, args.id);
        const auth = yield* AppleAuth;
        const session = yield* auth.ensureLoggedIn();
        const result = yield* revokeLocalApnsKey(api, {
          context: auth.buildRequestContext(session),
          pushKeyId: target.id,
          keyId: target.keyId,
          keepLocal: args["keep-local"] ?? false,
        });
        yield* printHuman("APNs push key revoke complete.");
        yield* printHumanKeyValue([
          ["Local ID", result.localId],
          ["Key ID", result.keyId],
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
    "push-key": pushKeyCommand,
  },
});
