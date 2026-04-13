import { Effect } from "effect";

import { EnvExportError } from "./exit-codes";

import type { ApiClient } from "../services/api-client";

export interface PullEnvVarsOptions {
  readonly projectId: string;
  readonly environment: string;
}

/**
 * Pull environment variables for a project + environment and flatten them into
 * a key/value map. Returns an empty map when the project has no variables.
 */
export const pullEnvVars = (
  api: ApiClient,
  { projectId, environment }: PullEnvVarsOptions,
): Effect.Effect<Record<string, string>, EnvExportError> =>
  api["env-vars"].export({ urlParams: { projectId, environment } }).pipe(
    Effect.map((result) => Object.fromEntries(result.items.map((item) => [item.key, item.value]))),
    Effect.mapError(
      (cause) =>
        new EnvExportError({
          message: `Failed to export environment variables for "${environment}": ${String(cause)}`,
        }),
    ),
  );
