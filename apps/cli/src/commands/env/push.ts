import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { uploadEnvVars } from "../../lib/env-exporter";
import { printHuman } from "../../lib/output";
import { readProfileEnvKeys } from "../../lib/profile-env";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";
import { envErrorExtras, formatEnvironments, parseDotenv, parseEnvironmentsArg } from "./helpers";

type Visibility = "plaintext" | "sensitive";

// Public client config (Metro inlines EXPO_PUBLIC_* into the bundle) stays a
// build-log-visible "plaintext" tier; everything else is masked as "sensitive".
const classifyVisibility = (key: string): Visibility =>
  key.startsWith("EXPO_PUBLIC_") ? "plaintext" : "sensitive";

export const pushCommand = defineCommand({
  meta: {
    name: "push",
    description:
      "Push (encrypt + upsert) env vars from a dotenv file. Auto-classifies EXPO_PUBLIC_* as plaintext, others as sensitive.",
  },
  args: {
    file: {
      type: "positional",
      required: false,
      default: ".env.local",
      description: "Path to dotenv file (default: .env.local)",
    },
    environment: {
      type: "string",
      default: "production",
      description:
        "Target environments (comma-separated, e.g. development,production). Default: production",
    },
    "include-profile-keys": {
      type: "boolean",
      description:
        "Also push keys that an eas.json build profile defines in its env block (skipped by default so eas.json config doesn't round-trip into the server store)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const content = yield* fs.readFileString(args.file);
        const parsed = parseDotenv(content);

        if (parsed.length === 0) {
          yield* printHuman(`No valid KEY=VALUE entries found in ${args.file}.`);
          return;
        }

        // Per-app config belongs in eas.json — keys any build profile defines
        // in its `env` block are skipped so an `env pull --profile` → `env push`
        // round-trip can't copy them into the server store.
        const runtime = yield* CliRuntime;
        const cwd = yield* runtime.cwd;
        const profileKeys =
          (args["include-profile-keys"] ?? false)
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
      }),
      envErrorExtras,
    ),
});
