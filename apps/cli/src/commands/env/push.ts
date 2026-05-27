import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { uploadEnvVars } from "../../lib/env-exporter";
import { readProjectId } from "../../lib/expo-config";
import { printHuman } from "../../lib/output";
import { apiClient } from "../../services/api-client";
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

        const environments = yield* parseEnvironmentsArg(args.environment);
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const result = yield* uploadEnvVars(api, {
          scope: "project",
          projectId,
          environments,
          entries: parsed.map((entry) => ({
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
