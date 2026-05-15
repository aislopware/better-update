import { Effect } from "effect";

import { EnvExportError } from "./exit-codes";

import type { ApiClient } from "../services/api-client";

type EnvironmentName = "development" | "preview" | "production";

export interface PullEnvVarsOptions {
  readonly projectId: string;
  readonly environment: string;
}

const coerceEnvironment = (raw: string): EnvironmentName | undefined =>
  raw === "development" || raw === "preview" || raw === "production" ? raw : undefined;

/**
 * Pull environment variables for a project + environment and flatten them into
 * a key/value map. Returns an empty map when the project has no variables.
 */
export const pullEnvVars = (
  api: ApiClient,
  { projectId, environment }: PullEnvVarsOptions,
): Effect.Effect<Record<string, string>, EnvExportError> => {
  const validated = coerceEnvironment(environment);
  if (!validated) {
    return Effect.fail(
      new EnvExportError({
        message: `Invalid environment "${environment}". Must be one of: development, preview, production.`,
      }),
    );
  }
  return api["env-vars"].export({ urlParams: { projectId, environment: validated } }).pipe(
    Effect.map((result) => Object.fromEntries(result.items.map((item) => [item.key, item.value]))),
    Effect.mapError(
      (cause) =>
        new EnvExportError({
          message: `Failed to export environment variables for "${environment}": ${String(cause)}`,
        }),
    ),
  );
};
