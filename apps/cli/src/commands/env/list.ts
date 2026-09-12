import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { printList } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { listAllEnvVars, optionalCell } from "./helpers";

export const listCommand = Command.make(
  "list",
  {
    environments: Flag.String("environments").pipe(
      Flag.withDescription(
        "Filter by environments (comma-separated, e.g. development,production). Default: all",
      ),
      optionalFlag,
    ),
    scope: Flag.Literals("scope", ["all", "project", "global"]).pipe(
      Flag.withDescription(
        "Filter by scope (default: all — merged with global override resolution)",
      ),
      optionalFlag,
    ),
    search: Flag.String("search").pipe(
      Flag.withDescription("Filter by key substring (case-insensitive)"),
      optionalFlag,
    ),
  },
  Effect.fn(function* (args) {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const urlParams = {
      projectId,
      ...(args.scope ? { scope: args.scope } : {}),
      ...(args.environments ? { environments: args.environments } : {}),
      ...(args.search ? { search: args.search } : {}),
    };

    const items = yield* listAllEnvVars(api, urlParams);

    yield* printList(
      ["Key", "Label", "Environment", "Scope", "Visibility", "Revisions"],
      items.map((item) => [
        item.key,
        optionalCell(item.label),
        item.environment,
        item.overridesGlobal ? `${item.scope} (overrides global)` : item.scope,
        item.visibility,
        String(item.revisionCount),
      ]),
      "No environment variables found.",
    );
  }, runCommand()),
).pipe(
  Command.withDescription(
    "List environment variable metadata. Values are end-to-end encrypted — read them with `env pull`, `env export`, or `env get`.",
  ),
);
