import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { openVaultSessionInteractive, sealForUpload } from "../../application/credential-cipher";
import { runEffect } from "../../lib/citty-effect";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import { EnvResourceNotFoundError, envErrorExtras, parseSingleEnvironmentArg } from "./helpers";

export const updateCommand = defineCommand({
  meta: {
    name: "update",
    description: "Update a project env var's value or visibility for an environment",
  },
  args: {
    key: { type: "positional", required: true, description: "Env var key (e.g. API_KEY)" },
    environment: {
      type: "string",
      default: "production",
      description: "Target environment (development, preview, production)",
    },
    value: { type: "string", description: "New value (leave unset to keep current)" },
    visibility: {
      type: "enum",
      options: ["plaintext", "sensitive"],
      description: "New visibility (leave unset to keep current)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const { key, value, visibility } = args;

        if (value === undefined && visibility === undefined) {
          return yield* new InvalidArgumentError({
            message: "Pass --value and/or --visibility. Nothing to update otherwise.",
          });
        }

        const environment = yield* parseSingleEnvironmentArg(args.environment);
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const { items } = yield* api["env-vars"].list({
          urlParams: { projectId, scope: "project", environments: environment },
        });
        const match = items.find((item) => item.key === key && item.environment === environment);
        if (!match) {
          return yield* new EnvResourceNotFoundError({
            message: `Env var "${key}" not found for environment "${environment}".`,
          });
        }

        if (value === undefined) {
          yield* api["env-vars"].update({
            path: { id: match.id },
            payload: compact({ visibility }),
          });
        } else {
          // A new value means a new sealed revision; the vault is unlocked to seal.
          const session = yield* openVaultSessionInteractive(api);
          const envelope = yield* sealForUpload({
            session,
            credentialType: "envVarValue",
            metadata: { key, environment },
            secret: { value },
          });
          yield* api["env-vars"].update({
            path: { id: match.id },
            payload: {
              value: {
                id: envelope.id,
                ciphertext: envelope.ciphertext,
                wrappedDek: envelope.wrappedDek,
                vaultVersion: envelope.vaultVersion,
              },
              ...compact({ visibility }),
            },
          });
        }

        const changed: string[] = [];
        if (value !== undefined) {
          changed.push("value");
        }
        if (visibility !== undefined) {
          changed.push("visibility");
        }
        yield* printHuman(`Updated ${changed.join(" + ")} for ${key} (${environment}).`);
        return undefined;
      }),
      envErrorExtras,
    ),
});
