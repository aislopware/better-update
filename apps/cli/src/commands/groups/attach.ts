import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHumanKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { groupErrorExtras } from "./helpers";

export const attachGroupPolicyCommand = defineCommand({
  meta: {
    name: "attach",
    description: "Attach a policy (real or managed:*) to a group; members inherit it",
  },
  args: {
    id: { type: "positional", required: true, description: "Group ID" },
    "policy-id": {
      type: "string",
      required: true,
      description: "Policy ID to attach (real id or managed preset like managed:admin)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const attachment = yield* api["policy-attachments"].attachToGroup({
          path: { id: args.id },
          payload: { policyId: args["policy-id"] },
        });
        yield* printHumanKeyValue([
          ["Attachment ID", attachment.id],
          ["Group ID", attachment.principalId],
          ["Policy ID", attachment.policyId],
          ["Created", attachment.createdAt],
        ]);
        return attachment;
      }),
      { exits: groupErrorExtras, json: "value" },
    ),
});
