import path from "node:path";

import { FileSystem, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { exportDecryptedEnvVars } from "../../lib/env-exporter";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { InteractiveMode } from "../../lib/interactive-mode";
import { printHuman } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { overlayProfileEnvItems, readOptionalProfile } from "../../lib/profile-env";
import { readProjectId } from "../../lib/project-link";
import { promptConfirm } from "../../lib/prompts";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";
import { parseEnvironmentScopeArg } from "./helpers";

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

export const pullCommand = Command.make(
  "pull",
  {
    environment: Flag.String("environment").pipe(
      Flag.withDescription(
        "Target environment (development, preview, production; defaults to --profile's environment, else production)",
      ),
      optionalFlag,
    ),
    profile: Flag.String("profile").pipe(
      Flag.withDescription(
        "eas.json build profile: its environment picks the scope and its env block overlays the pulled set (profile wins on collision) — same merge as `build`",
      ),
      optionalFlag,
    ),
    path: Flag.String("path").pipe(
      Flag.withDescription(`Output file path (default: ${DEFAULT_PATH})`),
      optionalFlag,
    ),
    stdout: Flag.Boolean("stdout").pipe(
      Flag.withDescription("Print `export KEY='value'` lines to stdout instead of writing a file"),
      Flag.withDefault(false),
    ),
    force: Flag.Boolean("force").pipe(
      Flag.withDescription("Overwrite the target file without prompting"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(
    function* (args) {
      const runtime = yield* CliRuntime;
      const cwd = yield* runtime.cwd;
      const profile = yield* readOptionalProfile(cwd, args.profile);
      const environment = yield* parseEnvironmentScopeArg(args.environment, profile);
      const projectId = yield* readProjectId;
      const api = yield* apiClient;

      // Fetches sealed envelopes and decrypts them locally (unlocks the vault),
      // then overlays the profile's eas.json env block (profile wins).
      const items = overlayProfileEnvItems(
        yield* exportDecryptedEnvVars(api, projectId, environment),
        profile,
      );

      if (args.stdout) {
        yield* printStdout(items);
        return { environment, target: "stdout", count: items.length, written: true };
      }
      const targetPath = path.resolve(cwd, args.path ?? DEFAULT_PATH);
      const written = yield* writeDotenvFile({
        targetPath,
        items,
        force: args.force,
      });
      return { environment, target: targetPath, count: items.length, written };
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    `Write env vars to a dotenv file (default: ${DEFAULT_PATH}) — or pipe to stdout with --stdout`,
  ),
);
