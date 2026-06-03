import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { printHuman } from "../../../lib/output";
import { readProjectId } from "../../../lib/project-link";
import { promptConfirm } from "../../../lib/prompts";
import { apiClient } from "../../../services/api-client";
import {
  ENV_GRANT_GLOBAL,
  EnvGrantCommandError,
  envGrantErrorExtras,
  isEnvironmentName,
} from "./helpers";

export const unsetCommand = defineCommand({
  meta: { name: "unset", description: "Revoke a member's env-var grants on a scope" },
  args: {
    member: { type: "string", required: true, description: "Member ID whose grants to revoke" },
    environment: { type: "string", required: true, description: "Environment" },
    project: { type: "string", description: "Project id (default: linked project)" },
    global: { type: "boolean", default: false, description: "Target the org-global scope" },
    yes: { type: "boolean", default: false, description: "Skip confirmation prompt" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const { environment } = args;
        if (!isEnvironmentName(environment)) {
          return yield* Effect.fail(
            new EnvGrantCommandError({ message: `Invalid environment "${environment}".` }),
          );
        }
        if (!args.yes) {
          const scopeLabel = args.global ? ENV_GRANT_GLOBAL : (args.project ?? "linked project");
          const confirmed = yield* promptConfirm(
            `Revoke env-var grants for member ${args.member} on ${scopeLabel}/${args.environment}?`,
            { initialValue: false },
          );
          if (!confirmed) {
            yield* printHuman("Cancelled.");
            return { deleted: 0 };
          }
        }

        const projectId = args.global ? null : (args.project ?? (yield* readProjectId));
        const api = yield* apiClient;

        const result = yield* api.envGrants.delete({
          payload: {
            memberId: args.member,
            projectId,
            environment,
          },
        });

        yield* printHuman(`Revoked env-var grants for member ${args.member}.`);
        return result;
      }),
      { exits: { ...envGrantErrorExtras }, json: "value" },
    ),
});
