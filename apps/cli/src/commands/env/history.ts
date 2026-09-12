import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { printList } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { findProjectEnvVar, parseSingleEnvironmentArg } from "./helpers";

export const historyCommand = Command.make(
  "history",
  {
    key: Argument.String("key").pipe(Argument.withDescription("Env var key")),
    environment: Flag.String("environment").pipe(
      Flag.withDescription("Target environment (development, preview, production)"),
      Flag.withDefault("production"),
    ),
  },
  Effect.fn(function* (args) {
    const environment = yield* parseSingleEnvironmentArg(args.environment);
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const match = yield* findProjectEnvVar(api, projectId, args.key, environment);
    const { items } = yield* api["env-vars"].revisions({ params: { id: match.id } });

    yield* printList(
      ["Revision", "Active", "Vault", "Created", "By"],
      items.map((revision) => [
        String(revision.revisionNumber),
        revision.isCurrent ? "current" : "",
        String(revision.vaultVersion),
        revision.createdAt,
        revision.createdBy ?? "-",
      ]),
      "No revisions found.",
    );
  }, runCommand()),
).pipe(Command.withDescription("Show a project env var's value revision history (metadata only)"));
