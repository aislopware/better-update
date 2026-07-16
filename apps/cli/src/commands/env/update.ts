import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { sealForUpload } from "../../application/credential-cipher";
import { openEnvVaultSessionInteractive } from "../../application/env-vault-access";
import { runEffect } from "../../lib/citty-effect";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import {
  describePayload,
  envErrorExtras,
  findProjectEnvVar,
  parseSingleEnvironmentArg,
} from "./helpers";

import type { ApiClient } from "../../services/api-client";
import type { EnvironmentName } from "./helpers";

type Visibility = "plaintext" | "sensitive";

/**
 * Apply a value and/or visibility change to one (key, environment) variable. A new
 * value seals a fresh revision under the unlocked env vault; visibility alone is a
 * plain metadata write. Kept out of the command body so the run handler stays under
 * the statement cap and the vault-touching path is isolated from the no-vault docs.
 */
const applyValueUpdate = (
  api: ApiClient,
  params: {
    readonly projectId: string;
    readonly key: string;
    readonly environment: EnvironmentName;
    readonly value: string | undefined;
    readonly visibility: Visibility | undefined;
  },
) =>
  Effect.gen(function* () {
    const { key, environment, projectId, value, visibility } = params;
    const match = yield* findProjectEnvVar(api, projectId, key, environment);

    if (value === undefined) {
      yield* api["env-vars"].update({ path: { id: match.id }, payload: compact({ visibility }) });
      return undefined;
    }

    // A new value means a new sealed revision; the env vault is unlocked to seal it
    // (credentials vault pre-cutover, env vault after).
    const session = yield* openEnvVaultSessionInteractive(api);
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
          vaultKind: session.vaultKind,
        },
        ...compact({ visibility }),
      },
    });
    return undefined;
  });

/** The human summary of which fields an update touched (in a stable order). */
const summarizeChanges = (args: {
  readonly value: string | undefined;
  readonly visibility: string | undefined;
  readonly label: string | undefined;
  readonly description: string | undefined;
}): string => {
  const parts: string[] = [];
  if (args.value !== undefined) {
    parts.push("value");
  }
  if (args.visibility !== undefined) {
    parts.push("visibility");
  }
  if (args.label !== undefined) {
    parts.push("label");
  }
  if (args.description !== undefined) {
    parts.push("description");
  }
  return parts.join(" + ");
};

export const updateCommand = defineCommand({
  meta: {
    name: "update",
    description: "Update a project env var's value, visibility, or documentation",
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
    label: {
      type: "string",
      description:
        'Set the variable\'s label (shared across environments; non-secret). Pass "" to clear.',
    },
    description: {
      type: "string",
      description: 'Set the variable\'s description (shared; non-secret). Pass "" to clear.',
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const { key, value, visibility } = args;
        const docs = describePayload(args.label, args.description);
        const touchesValue = value !== undefined || visibility !== undefined;

        if (!touchesValue && !docs) {
          return yield* new InvalidArgumentError({
            message:
              "Pass --value, --visibility, --label and/or --description. Nothing to update otherwise.",
          });
        }

        const environment = yield* parseSingleEnvironmentArg(args.environment);
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        // Documentation (label/description) is non-secret and shared per (scope,
        // key), so it is a separate no-vault call independent of the value change.
        if (docs) {
          yield* api["env-vars"].upsertDescription({
            payload: { scope: "project", projectId, key, ...docs },
          });
        }

        if (touchesValue) {
          yield* applyValueUpdate(api, { projectId, key, environment, value, visibility });
        }

        const changed = summarizeChanges({
          value,
          visibility,
          label: args.label,
          description: args.description,
        });
        const envSuffix = touchesValue ? ` (${environment})` : "";
        yield* printHuman(`Updated ${changed} for ${key}${envSuffix}.`);
        return undefined;
      }),
      envErrorExtras,
    ),
});
