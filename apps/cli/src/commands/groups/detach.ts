import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { groupErrorExtras } from "./helpers";

export const detachGroupPolicyCommand = defineCommand({
  meta: { name: "detach", description: "Remove a policy attachment from a group" },
  args: {
    id: { type: "positional", required: true, description: "Group ID" },
    "policy-id": {
      type: "string",
      required: true,
      description: "Policy ID to detach (real id or managed preset like managed:admin)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        yield* api["policy-attachments"].detachFromGroup({
          path: { id: args.id, policyId: encodeURIComponent(args["policy-id"]) },
        });
        yield* printHuman(`Detached policy ${args["policy-id"]} from group ${args.id}.`);
        return { groupId: args.id, policyId: args["policy-id"], detached: true };
      }),
      { exits: groupErrorExtras, json: "value" },
    ),
});
