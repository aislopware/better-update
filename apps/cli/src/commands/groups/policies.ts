import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHumanTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { groupErrorExtras } from "./helpers";

export const listGroupPoliciesCommand = defineCommand({
  meta: { name: "policies", description: "List policies attached to a group" },
  args: {
    id: { type: "positional", required: true, description: "Group ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const result = yield* api["policy-attachments"].listForGroup({
          path: { id: args.id },
        });
        yield* printHumanTable(
          ["Attachment ID", "Policy ID", "Created"],
          result.items.map((attachment) => [
            attachment.id,
            attachment.policyId,
            attachment.createdAt,
          ]),
        );
        return result;
      }),
      { exits: groupErrorExtras, json: "value" },
    ),
});
