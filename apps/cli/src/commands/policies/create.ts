import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHumanKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { parsePolicyDocument, policyErrorExtras } from "./helpers";

const DOCUMENT_HELP =
  'JSON document string: {"statements":[{"effect":"allow"|"deny","actions":["<resource>:<action>"|"<resource>:*"|"*"],"resources":["*"|"project/A"|"project/*/env/production"]}]}';

export const createPolicyCommand = defineCommand({
  meta: {
    name: "create",
    description: "Create a named IAM policy from a JSON document",
  },
  args: {
    name: { type: "string", required: true, description: "Policy display name" },
    description: { type: "string", description: "Optional human description" },
    document: {
      type: "string",
      required: true,
      description: DOCUMENT_HELP,
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const document = yield* parsePolicyDocument(args.document);
        const api = yield* apiClient;
        const policy = yield* api.policies.create({
          payload: {
            name: args.name,
            document,
            ...compact({ description: args.description }),
          },
        });
        yield* printHumanKeyValue([
          ["ID", policy.id],
          ["Name", policy.name],
          ["Description", policy.description ?? "-"],
          ["Statements", String(policy.document.statements.length)],
          ["Created", policy.createdAt],
        ]);
        return policy;
      }),
      { exits: policyErrorExtras, json: "value" },
    ),
});
