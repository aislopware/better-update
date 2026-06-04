import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";
import { promptConfirm } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";
import { isManagedPolicyId, PolicyCommandError, policyErrorExtras } from "./helpers";

export const deletePolicyCommand = defineCommand({
  meta: {
    name: "delete",
    description: "Delete a policy and sweep its attachments (managed presets cannot be deleted)",
  },
  args: {
    id: { type: "positional", required: true, description: "Policy ID" },
    yes: { type: "boolean", description: "Skip confirmation prompt" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        if (isManagedPolicyId(args.id)) {
          return yield* new PolicyCommandError({
            message: `Policy "${args.id}" is a managed preset and cannot be deleted.`,
          });
        }
        if (!args.yes) {
          const confirmed = yield* promptConfirm(`Delete policy ${args.id}?`, {
            initialValue: false,
          });
          if (!confirmed) {
            yield* printHuman("Cancelled.");
            return undefined;
          }
        }
        const api = yield* apiClient;
        yield* api.policies.delete({ path: { id: args.id } });
        yield* printHuman(`Deleted policy ${args.id}.`);
        return { id: args.id, deleted: true };
      }),
      { exits: policyErrorExtras, json: "value" },
    ),
});
