import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { readProjectId } from "../../lib/expo-config";
import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import {
  envErrorExtras,
  EnvResourceNotFoundError,
  formatEnvironments,
  parseSingleEnvironmentArg,
} from "./helpers";

import type { EnvironmentName } from "./helpers";

interface EnvVarResponse {
  readonly id: string;
  readonly key: string;
  readonly scope: string;
  readonly visibility: "plaintext" | "sensitive";
  readonly value: string | null;
  readonly environments: readonly EnvironmentName[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

const resolveByKey = (
  api: Effect.Effect.Success<typeof apiClient>,
  key: string,
  environment: string | undefined,
) =>
  Effect.gen(function* () {
    const env =
      environment === undefined ? undefined : yield* parseSingleEnvironmentArg(environment);
    const projectId = yield* readProjectId;
    const urlParams = {
      projectId,
      scope: "all" as const,
      search: key,
      ...compact({ environments: env }),
    };
    const { items } = yield* api["env-vars"].list({ urlParams });
    const matches = items.filter((item) => item.key === key);
    if (matches.length === 0) {
      return yield* new EnvResourceNotFoundError({
        message: `No env var with key "${key}" found${env === undefined ? "" : ` for environment "${env}"`}.`,
      });
    }
    if (matches.length > 1) {
      const envs = [...new Set(matches.flatMap((entry) => entry.environments))].join(", ");
      return yield* new EnvResourceNotFoundError({
        message: `Multiple env vars match key "${key}". Disambiguate with --environment <${envs}>.`,
      });
    }
    // eslint-disable-next-line typescript/no-non-null-assertion -- length === 1 guarded above
    return matches[0]!;
  });

const renderValue = (envVar: EnvVarResponse, includeSensitive: boolean): string => {
  if (envVar.visibility === "plaintext") {
    // eslint-disable-next-line eslint-js/no-restricted-syntax -- EnvVar.value nullable at storage; display empty when absent
    return envVar.value ?? "";
  }
  if (includeSensitive) {
    // eslint-disable-next-line eslint-js/no-restricted-syntax -- EnvVar.value nullable at storage; display empty when absent
    return envVar.value ?? "";
  }
  return "******";
};

export const getCommand = defineCommand({
  meta: { name: "get", description: "Show an environment variable by KEY (or --by-id)" },
  args: {
    key: {
      type: "positional",
      required: true,
      description: "Env var KEY (uppercase) — or ID when used with --by-id",
    },
    environment: {
      type: "string",
      description: "Filter by environment when looking up by KEY",
    },
    "by-id": {
      type: "boolean",
      description: "Treat the argument as an ID instead of KEY",
    },
    "include-sensitive": {
      type: "boolean",
      description: "Reveal masked sensitive values",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const envVar = args["by-id"]
          ? yield* api["env-vars"].get({ path: { id: args.key } })
          : yield* resolveByKey(api, args.key, args.environment);

        yield* printKeyValue([
          ["ID", envVar.id],
          ["Key", envVar.key],
          ["Scope", envVar.scope],
          ["Environments", formatEnvironments(envVar.environments)],
          ["Visibility", envVar.visibility],
          ["Value", renderValue(envVar, args["include-sensitive"] ?? false)],
          ["Created", envVar.createdAt],
          ["Updated", envVar.updatedAt],
        ]);
      }),
      envErrorExtras,
    ),
});
