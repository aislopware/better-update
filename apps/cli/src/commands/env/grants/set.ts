import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { printHumanKeyValue } from "../../../lib/output";
import { readProjectId } from "../../../lib/project-link";
import { apiClient } from "../../../services/api-client";
import {
  ENVIRONMENTS,
  EnvGrantCommandError,
  envGrantErrorExtras,
  isEnvironmentName,
} from "./helpers";

export const setCommand = defineCommand({
  meta: { name: "set", description: "Create or replace a member's env-var grant on a scope" },
  args: {
    member: { type: "string", required: true, description: "Member ID to grant" },
    environment: {
      type: "string",
      required: true,
      description: "Environment: development | preview | production",
    },
    actions: {
      type: "string",
      description: "Comma-separated envVar:* tokens (default: envVar:read)",
    },
    effect: { type: "string", description: "allow (default) or deny" },
    project: { type: "string", description: `Project id (default: linked project)` },
    global: {
      type: "boolean",
      default: false,
      description: "Target the org-global env-var scope",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const effectValue = args.effect ?? "allow";
        if (effectValue !== "allow" && effectValue !== "deny") {
          return yield* new EnvGrantCommandError({ message: `Invalid effect "${effectValue}".` });
        }
        const { environment } = args;
        if (!isEnvironmentName(environment)) {
          return yield* new EnvGrantCommandError({
            message: `Invalid environment "${environment}". One of: ${ENVIRONMENTS.join(", ")}.`,
          });
        }
        const actionTokens = (args.actions ?? "envVar:read")
          .split(",")
          .map((tok) => tok.trim())
          .filter((tok) => tok.length > 0);
        if (actionTokens.length === 0) {
          return yield* new EnvGrantCommandError({
            message: "At least one action token is required.",
          });
        }

        const projectId = args.global ? null : (args.project ?? (yield* readProjectId));
        const api = yield* apiClient;

        const grant = yield* api.envGrants.upsert({
          payload: {
            memberId: args.member,
            projectId,
            environment,
            effect: effectValue,
            actions: actionTokens,
          },
        });

        yield* printHumanKeyValue([
          ["ID", grant.id],
          ["Member ID", grant.memberId],
          ["Scope", grant.scopeId],
          ["Effect", grant.effect],
          ["Actions", grant.actions.join(", ")],
          ["Created", grant.createdAt],
        ]);
        return grant;
      }),
      { exits: { ...envGrantErrorExtras } },
    ),
});
