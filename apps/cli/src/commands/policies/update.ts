import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHumanKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import {
  isManagedPolicyId,
  parsePolicyDocument,
  PolicyCommandError,
  policyErrorExtras,
} from "./helpers";

export const updatePolicyCommand = defineCommand({
  meta: {
    name: "update",
    description: "Update a policy's name, description, or document (managed presets are read-only)",
  },
  args: {
    id: { type: "positional", required: true, description: "Policy ID" },
    name: { type: "string", description: "New display name" },
    description: { type: "string", description: "New description" },
    document: { type: "string", description: "Replacement JSON document string" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        if (isManagedPolicyId(args.id)) {
          return yield* new PolicyCommandError({
            message: `Policy "${args.id}" is a managed preset and is read-only. Create a custom policy instead.`,
          });
        }
        const document =
          args.document === undefined ? undefined : yield* parsePolicyDocument(args.document);
        const api = yield* apiClient;
        const policy = yield* api.policies.update({
          path: { id: args.id },
          payload: compact({
            name: args.name,
            description: args.description,
            document,
          }),
        });
        yield* printHumanKeyValue([
          ["ID", policy.id],
          ["Name", policy.name],
          ["Description", policy.description ?? "-"],
          ["Statements", String(policy.document.statements.length)],
          ["Updated", policy.updatedAt ?? "-"],
        ]);
        return policy;
      }),
      { exits: policyErrorExtras, json: "value" },
    ),
});
