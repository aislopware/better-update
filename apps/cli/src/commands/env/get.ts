import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { exportDecryptedEnvVars } from "../../lib/env-exporter";
import { printKeyValue } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { EnvResourceNotFoundError, listAllEnvVars, parseSingleEnvironmentArg } from "./helpers";

export const getCommand = Command.make(
  "get",
  {
    key: Argument.String("key").pipe(Argument.withDescription("Env var KEY (uppercase)")),
    environment: Flag.String("environment").pipe(
      Flag.withDescription("Target environment (development, preview, production)"),
      Flag.withDefault("production"),
    ),
    "include-sensitive": Flag.Boolean("include-sensitive").pipe(
      Flag.withDescription("Reveal masked sensitive values"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(function* (args) {
    const environment = yield* parseSingleEnvironmentArg(args.environment);
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    // Resolves the effective (project-over-global) value, decrypted locally.
    const items = yield* exportDecryptedEnvVars(api, projectId, environment);
    const match = items.find((item) => item.key === args.key);
    if (!match) {
      return yield* new EnvResourceNotFoundError({
        message: `No env var "${args.key}" found for environment "${environment}".`,
      });
    }

    const includeSensitive = args["include-sensitive"];
    const value = match.visibility === "sensitive" && !includeSensitive ? "******" : match.value;

    // The effective variable's non-secret documentation (shared per scope+key),
    // resolved from the metadata list so `get` explains what the value is for.
    const metadata = yield* listAllEnvVars(api, {
      projectId,
      scope: "all",
      environments: environment,
      search: match.key,
    });
    const meta = metadata.find((item) => item.key === match.key);

    const pairs: [string, string][] = [
      ["Key", match.key],
      ["Environment", environment],
    ];
    if (meta?.label) {
      pairs.push(["Label", meta.label]);
    }
    if (meta?.description) {
      pairs.push(["Description", meta.description]);
    }
    pairs.push(["Visibility", match.visibility], ["Value", value]);

    yield* printKeyValue(pairs);
    return undefined;
  }, runCommand()),
).pipe(
  Command.withDescription(
    "Show an environment variable's effective value for an environment (decrypted locally)",
  ),
);
