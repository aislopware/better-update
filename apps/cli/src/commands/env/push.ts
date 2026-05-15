import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { readProjectId } from "../../lib/expo-config";
import { InteractiveMode } from "../../lib/interactive-mode";
import { printHuman } from "../../lib/output";
import { promptMultiSelect } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";
import { envErrorExtras, formatEnvironments, parseEnvironmentsArg } from "./helpers";

type Visibility = "plaintext" | "sensitive";

interface ParsedVar {
  readonly key: string;
  readonly value: string;
  readonly visibility: Visibility;
}

const LINE_PATTERN = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/u;

const stripQuotes = (raw: string): string => {
  if (raw.length < 2) {
    return raw;
  }
  const [first] = raw;
  const last = raw.at(-1);
  const quoted = (first === '"' && last === '"') || (first === "'" && last === "'");
  return quoted ? raw.slice(1, -1) : raw;
};

const classifyVisibility = (key: string): Visibility =>
  key.startsWith("EXPO_PUBLIC_") ? "plaintext" : "sensitive";

const parseLine = (rawLine: string): ParsedVar | undefined => {
  const line = rawLine.trim();
  if (line === "" || line.startsWith("#")) {
    return undefined;
  }
  const match = LINE_PATTERN.exec(line);
  if (!match) {
    return undefined;
  }
  const [, key, rawValue] = match;
  if (key === undefined || rawValue === undefined) {
    return undefined;
  }
  return { key, value: stripQuotes(rawValue), visibility: classifyVisibility(key) };
};

const parseDotenv = (content: string): readonly ParsedVar[] =>
  content
    .split(/\r?\n/u)
    .map(parseLine)
    .filter((entry): entry is ParsedVar => entry !== undefined);

export const pushCommand = defineCommand({
  meta: {
    name: "push",
    description:
      "Push env vars from a dotenv file. Auto-classifies EXPO_PUBLIC_* as plaintext, others as sensitive.",
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
    force: {
      type: "boolean",
      description: "Overwrite existing vars without prompting",
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

        const existingResp = yield* api["env-vars"].list({
          urlParams: { projectId, scope: "project" },
        });
        const existingByKey = new Map(existingResp.items.map((item) => [item.key, item]));

        const conflicts = parsed.filter((entry) => existingByKey.has(entry.key));
        const newEntries = parsed.filter((entry) => !existingByKey.has(entry.key));

        const resolveOverwriteSet = Effect.gen(function* () {
          if (conflicts.length === 0 || args.force) {
            return conflicts;
          }
          const mode = yield* InteractiveMode;
          if (!mode.allow) {
            const conflictKeys = conflicts.map((conflict) => conflict.key).join(", ");
            return yield* new InvalidArgumentError({
              message: `${String(conflicts.length)} conflict(s): ${conflictKeys}. Pass --force to overwrite or run interactively.`,
            });
          }
          const picked = yield* promptMultiSelect<string>(
            "Overwrite which existing vars?",
            conflicts.map((entry) => ({
              value: entry.key,
              label: `${entry.key} (${existingByKey.get(entry.key)?.visibility ?? "?"} → ${entry.visibility})`,
            })),
          );
          const pickedSet = new Set(picked);
          return conflicts.filter((entry) => pickedSet.has(entry.key));
        });

        const entriesToOverwrite = yield* resolveOverwriteSet;

        const skipped = conflicts.length - entriesToOverwrite.length;

        yield* Effect.forEach(
          newEntries,
          (entry) =>
            api["env-vars"].create({
              payload: {
                scope: "project",
                projectId,
                environments,
                key: entry.key,
                value: entry.value,
                visibility: entry.visibility,
              },
            }),
          { concurrency: 4 },
        );

        yield* Effect.forEach(
          entriesToOverwrite,
          (entry) => {
            const existing = existingByKey.get(entry.key);
            if (!existing) {
              return Effect.succeed(undefined);
            }
            return api["env-vars"].update({
              path: { id: existing.id },
              payload: {
                value: entry.value,
                visibility: entry.visibility,
                environments,
              },
            });
          },
          { concurrency: 4 },
        );

        yield* printHuman(
          `Pushed to ${formatEnvironments(environments)}: ${String(newEntries.length)} created, ${String(
            entriesToOverwrite.length,
          )} updated${skipped > 0 ? `, ${String(skipped)} skipped` : ""}.`,
        );
      }),
      envErrorExtras,
    ),
});
