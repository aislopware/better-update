import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { easJsonPath, parseEasConfig } from "../../lib/eas-config";
import {
  DEFAULT_EAS_JSON,
  DEFAULT_PROFILE_NAMES,
  ensureDefaultBuildProfiles,
} from "../../lib/eas-json";
import { BuildProfileError } from "../../lib/exit-codes";
import { InteractiveMode } from "../../lib/interactive-mode";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { promptConfirm } from "../../lib/prompts";
import { CliRuntime } from "../../services/cli-runtime";

const writeEasJson = (filePath: string, value: unknown) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs
      .writeFileString(filePath, `${JSON.stringify(value, null, 2)}\n`)
      .pipe(
        Effect.mapError(
          (cause) =>
            new BuildProfileError({ message: `Failed to write eas.json: ${cause.message}` }),
        ),
      );
  });

export const configureBuildCommand = defineCommand({
  meta: {
    name: "configure",
    description: "Scaffold or top up eas.json with default development/preview/production profiles",
  },
  args: {
    force: {
      type: "boolean",
      description: "Overwrite an existing eas.json with the defaults",
    },
  },
  run: async ({ args }) =>
    runEffect(
      // eslint-disable-next-line eslint/max-statements -- linear orchestration: detect → branch on (missing|invalid|valid)
      Effect.gen(function* () {
        // Non-interactive (global --non-interactive / CI / --json) confirms with the
        // default action: --force already encodes overwrite intent, and topping up
        // missing profiles is additive. No local flag — the global gate is the
        // single source of truth.
        const { allow: interactive } = yield* InteractiveMode;
        const runtime = yield* CliRuntime;
        const projectRoot = yield* runtime.cwd;
        const filePath = easJsonPath(projectRoot);

        const fs = yield* FileSystem.FileSystem;
        const exists = yield* fs.exists(filePath);

        // --force: hard reset to the default template (drops any existing keys).
        if (args.force === true) {
          const proceed =
            exists && interactive
              ? yield* promptConfirm(`Overwrite existing eas.json at ${filePath} with defaults?`)
              : true;
          if (!proceed) {
            yield* printHuman("Aborted. eas.json was not modified.");
            return { action: "aborted" as const, path: filePath };
          }
          yield* writeEasJson(filePath, DEFAULT_EAS_JSON);
          yield* printHuman(
            exists
              ? "Overwrote eas.json with default profiles."
              : `Wrote eas.json with default profiles to ${filePath}.`,
          );
          return {
            action: exists ? "overwritten" : "created",
            path: filePath,
            profiles: [...DEFAULT_PROFILE_NAMES],
          };
        }

        // Fresh scaffold — `ensureDefaultBuildProfiles` writes the full template.
        if (!exists) {
          const created = yield* ensureDefaultBuildProfiles(projectRoot);
          yield* printHuman(`Wrote eas.json with default profiles to ${created.path}.`);
          yield* printHumanKeyValue([
            ["Profiles", created.added.join(", ")],
            ["Path", created.path],
          ]);
          return { action: "created" as const, path: created.path, profiles: created.added };
        }

        // Existing file: validate it parses (surface errors) before topping up.
        const existingRaw = yield* fs
          .readFileString(filePath)
          .pipe(
            Effect.mapError(
              (cause) =>
                new BuildProfileError({ message: `Failed to read eas.json: ${cause.message}` }),
            ),
          );
        const config = yield* parseEasConfig(existingRaw);
        const existingProfiles = Object.keys(config.build ?? {});
        const missing = DEFAULT_PROFILE_NAMES.filter((name) => !existingProfiles.includes(name));

        if (missing.length === 0) {
          yield* printHuman(
            `eas.json already defines all default profiles (${existingProfiles.join(", ")}). Nothing to add.`,
          );
          yield* printHuman("Pass --force to overwrite with the default template.");
          return { action: "noop" as const, path: filePath, existing: existingProfiles };
        }

        const proceed = interactive
          ? yield* promptConfirm(
              `Add missing profile(s) [${missing.join(", ")}] to existing eas.json?`,
              { initialValue: true },
            )
          : true;
        if (!proceed) {
          yield* printHuman("Aborted. eas.json was not modified.");
          return { action: "aborted" as const, path: filePath };
        }

        // Key-preserving top-up: only the missing default profiles are added,
        // every existing profile and top-level key (projectId, …) is retained.
        const result = yield* ensureDefaultBuildProfiles(projectRoot);
        yield* printHuman(`Added profile(s) to eas.json: ${result.added.join(", ")}.`);
        yield* printHumanKeyValue([
          ["Existing", existingProfiles.join(", ") || "(none)"],
          ["Added", result.added.join(", ")],
          ["Path", result.path],
        ]);
        return {
          action: "topped-up" as const,
          path: result.path,
          existing: existingProfiles,
          added: result.added,
        };
      }),
      { json: "value" },
    ),
});
