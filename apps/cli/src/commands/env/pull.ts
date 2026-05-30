import path from "node:path";

import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { exportDecryptedEnvVars } from "../../lib/env-exporter";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { readProjectId } from "../../lib/expo-config";
import { InteractiveMode } from "../../lib/interactive-mode";
import { printHuman } from "../../lib/output";
import { promptConfirm } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";
import { envErrorExtras, parseSingleEnvironmentArg } from "./helpers";

import type { OutputMode } from "../../lib/output-mode";

const DEFAULT_PATH = ".env.local";

const escapeShellSingleQuoted = (value: string): string => value.replaceAll("'", String.raw`'\''`);

const escapeDotenvDoubleQuoted = (value: string): string =>
  // Escape backslash first, then ", $ (to avoid shell expansion when sourced),
  // and convert real newlines to literal \n so the file stays single-line per
  // entry (dotenv parsers re-expand on read).
  `"${value
    .replaceAll("\\", String.raw`\\`)
    .replaceAll('"', String.raw`\"`)
    .replaceAll("$", String.raw`\$`)
    .replaceAll("\n", String.raw`\n`)
    .replaceAll("\r", String.raw`\r`)}"`;

const printStdout = (
  items: readonly { readonly key: string; readonly value: string }[],
): Effect.Effect<void, never, OutputMode> =>
  Effect.forEach(
    items,
    (item) => printHuman(`export ${item.key}='${escapeShellSingleQuoted(item.value)}'`),
    { discard: true },
  );

const writeDotenvFile = (params: {
  readonly targetPath: string;
  readonly items: readonly { readonly key: string; readonly value: string }[];
  readonly force: boolean;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(params.targetPath).pipe(Effect.orElseSucceed(() => false));
    if (exists && !params.force) {
      const mode = yield* InteractiveMode;
      if (!mode.allow) {
        return yield* new InvalidArgumentError({
          message: `${params.targetPath} already exists. Pass --force to overwrite, or --stdout to print instead.`,
        });
      }
      const ok = yield* promptConfirm(`Overwrite ${params.targetPath}?`, {
        initialValue: false,
      });
      if (!ok) {
        yield* printHuman("Aborted.");
        return false;
      }
    }
    const body = `${params.items
      .map((item) => `${item.key}=${escapeDotenvDoubleQuoted(item.value)}`)
      .join("\n")}\n`;
    yield* fs.writeFileString(params.targetPath, body);
    yield* printHuman(`Wrote ${String(params.items.length)} env vars to ${params.targetPath}`);
    return true;
  });

export const pullCommand = defineCommand({
  meta: {
    name: "pull",
    description: `Write env vars to a dotenv file (default: ${DEFAULT_PATH}) — or pipe to stdout with --stdout`,
  },
  args: {
    environment: {
      type: "string",
      default: "production",
      description: "Target environment (development, preview, production)",
    },
    path: {
      type: "string",
      description: `Output file path (default: ${DEFAULT_PATH})`,
    },
    stdout: {
      type: "boolean",
      description: "Print `export KEY='value'` lines to stdout instead of writing a file",
    },
    force: {
      type: "boolean",
      description: "Overwrite the target file without prompting",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const environment = yield* parseSingleEnvironmentArg(args.environment);
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        // Fetches sealed envelopes and decrypts them locally (unlocks the vault).
        const items = yield* exportDecryptedEnvVars(api, projectId, environment);

        if (args.stdout) {
          yield* printStdout(items);
          return { environment, target: "stdout", count: items.length, written: true };
        }

        const runtime = yield* CliRuntime;
        const cwd = yield* runtime.cwd;
        const targetPath = path.resolve(cwd, args.path ?? DEFAULT_PATH);
        const written = yield* writeDotenvFile({
          targetPath,
          items,
          force: args.force ?? false,
        });
        return { environment, target: targetPath, count: items.length, written };
      }),
      { exits: envErrorExtras, json: "value" },
    ),
});
