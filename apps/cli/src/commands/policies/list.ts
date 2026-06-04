import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHumanTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { isManagedPolicyId, policyErrorExtras } from "./helpers";

export const listPoliciesCommand = defineCommand({
  meta: {
    name: "list",
    description: "List policies in the active organization (includes read-only managed presets)",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const result = yield* api.policies.list();
        yield* printHumanTable(
          ["ID", "Name", "Statements", "Managed"],
          result.items.map((policy) => [
            policy.id,
            policy.name,
            String(policy.document.statements.length),
            isManagedPolicyId(policy.id) ? "yes" : "no",
          ]),
        );
        return result;
      }),
      { exits: policyErrorExtras, json: "value" },
    ),
});
