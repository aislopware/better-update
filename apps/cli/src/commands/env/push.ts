import { FileSystem, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { uploadEnvVars } from "../../lib/env-exporter";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman } from "../../lib/output";
import { readProfileEnvKeys } from "../../lib/profile-env";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";
import { formatEnvironments, parseDotenv, parseEnvironmentsArg } from "./helpers";

type Visibility = "plaintext" | "sensitive";

// Public client config (Metro inlines EXPO_PUBLIC_* into the bundle) stays a
// build-log-visible "plaintext" tier; everything else is masked as "sensitive".
const classifyVisibility = (key: string): Visibility =>
  key.startsWith("EXPO_PUBLIC_") ? "plaintext" : "sensitive";

export const pushCommand = Command.make(
  "push",
  {
    file: Argument.String("file").pipe(
      Argument.withDescription("Path to dotenv file (default: .env.local)"),
      Argument.withDefault(".env.local"),
    ),
    environment: Flag.String("environment").pipe(
      Flag.withDescription(
        "Target environments (comma-separated, e.g. development,production). Default: production",
      ),
      Flag.withDefault("production"),
    ),
    "include-profile-keys": Flag.Boolean("include-profile-keys").pipe(
      Flag.withDescription(
        "Also push keys that an eas.json build profile defines in its env block (skipped by default so eas.json config doesn't round-trip into the server store)",
      ),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(function* (args) {
    const fs = yield* FileSystem.FileSystem;
    const content = yield* fs.readFileString(args.file);
    const parsed = parseDotenv(content);

    if (parsed.length === 0) {
      return yield* new InvalidArgumentError({
        message: `No valid KEY=VALUE entries found in ${args.file}.`,
      });
    }

    // Per-app config belongs in eas.json — keys any build profile defines
    // in its `env` block are skipped so an `env pull --profile` → `env push`
    // round-trip can't copy them into the server store.
    const runtime = yield* CliRuntime;
    const cwd = yield* runtime.cwd;
    const profileKeys = args["include-profile-keys"]
      ? new Set<string>()
      : yield* readProfileEnvKeys(cwd);
    const entries = parsed.filter((entry) => !profileKeys.has(entry.key));
    const skipped = parsed.filter((entry) => profileKeys.has(entry.key));

    if (skipped.length > 0) {
      yield* printHuman(
        `Skipped ${String(skipped.length)} key(s) defined in eas.json build profiles (${skipped
          .map((entry) => entry.key)
          .join(", ")}) — pass --include-profile-keys to push them anyway.`,
      );
    }
    if (entries.length === 0) {
      yield* printHuman("Nothing left to push.");
      return;
    }

    const environments = yield* parseEnvironmentsArg(args.environment);
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const result = yield* uploadEnvVars(api, {
      scope: "project",
      projectId,
      environments,
      entries: entries.map((entry) => ({
        key: entry.key,
        value: entry.value,
        visibility: classifyVisibility(entry.key),
      })),
    });

    yield* printHuman(
      `Pushed to ${formatEnvironments(environments)}: ${String(result.created)} created, ${String(
        result.updated,
      )} updated${result.skipped > 0 ? `, ${String(result.skipped)} skipped` : ""}.`,
    );
  }, runCommand()),
).pipe(
  Command.withDescription(
    "Push (encrypt + upsert) env vars from a dotenv file. Auto-classifies EXPO_PUBLIC_* as plaintext, others as sensitive.",
  ),
);
