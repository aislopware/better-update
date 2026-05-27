import path from "node:path";

import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { exportDecryptedEnvVars } from "../../lib/env-exporter";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { readProjectId } from "../../lib/expo-config";
import { InteractiveMode } from "../../lib/interactive-mode";
import { promptConfirm } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";
import { envErrorExtras, parseSingleEnvironmentArg } from "./helpers";

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

const printStdout = (items: readonly { readonly key: string; readonly value: string }[]) =>
  Effect.forEach(
    items,
    (item) => Console.log(`export ${item.key}='${escapeShellSingleQuoted(item.value)}'`),
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
        yield* Console.log("Aborted.");
        return undefined;
      }
    }
    const body = `${params.items
      .map((item) => `${item.key}=${escapeDotenvDoubleQuoted(item.value)}`)
      .join("\n")}\n`;
    yield* fs.writeFileString(params.targetPath, body);
    yield* Console.log(`Wrote ${String(params.items.length)} env vars to ${params.targetPath}`);
    return undefined;
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
          return;
        }

        const runtime = yield* CliRuntime;
        const cwd = yield* runtime.cwd;
        const targetPath = path.resolve(cwd, args.path ?? DEFAULT_PATH);
        yield* writeDotenvFile({
          targetPath,
          items,
          force: args.force ?? false,
        });
      }),
      envErrorExtras,
    ),
});
