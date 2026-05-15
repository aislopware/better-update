import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { envErrorExtras, formatEnvironments } from "./helpers";

export const getCommand = defineCommand({
  meta: { name: "get", description: "Show an environment variable" },
  args: {
    id: { type: "positional", required: true, description: "Env var ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const envVar = yield* api["env-vars"].get({ path: { id: args.id } });
        yield* printKeyValue([
          ["ID", envVar.id],
          ["Key", envVar.key],
          ["Scope", envVar.scope],
          ["Environments", formatEnvironments(envVar.environments)],
          ["Visibility", envVar.visibility],
          // eslint-disable-next-line eslint-js/no-restricted-syntax -- EnvVar.value nullable at storage; display empty when absent
          ["Value", envVar.visibility === "plaintext" ? (envVar.value ?? "") : "******"],
          ["Created", envVar.createdAt],
          ["Updated", envVar.updatedAt],
        ]);
      }),
      envErrorExtras,
    ),
});
