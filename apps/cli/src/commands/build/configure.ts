import path from "node:path";

import { compact } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { parseEasConfig } from "../../lib/eas-config";
import { BuildProfileError } from "../../lib/exit-codes";
import { InteractiveMode } from "../../lib/interactive-mode";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { promptConfirm } from "../../lib/prompts";
import { CliRuntime } from "../../services/cli-runtime";

const DEFAULT_EAS_JSON = {
  cli: {
    version: ">= 7.0.0",
  },
  build: {
    development: {
      developmentClient: true,
      distribution: "internal",
      channel: "development",
      environment: "development",
      android: { format: "apk" },
    },
    preview: {
      distribution: "internal",
      channel: "preview",
      environment: "preview",
      android: { format: "apk" },
    },
    production: {
      channel: "production",
      environment: "production",
      android: { format: "aab" },
    },
  },
};

const DEFAULT_PROFILES = ["development", "preview", "production"] as const;

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
        const easJsonPath = path.join(projectRoot, "eas.json");

        const fs = yield* FileSystem.FileSystem;
        const exists = yield* fs.exists(easJsonPath);

        if (!exists) {
          yield* writeEasJson(easJsonPath, DEFAULT_EAS_JSON);
          yield* printHuman(`Wrote eas.json with default profiles to ${easJsonPath}.`);
          yield* printHumanKeyValue([
            ["Profiles", DEFAULT_PROFILES.join(", ")],
            ["Path", easJsonPath],
          ]);
          return {
            action: "created" as const,
            path: easJsonPath,
            profiles: [...DEFAULT_PROFILES],
          };
        }

        if (args.force === true) {
          const proceed = interactive
            ? yield* promptConfirm(`Overwrite existing eas.json at ${easJsonPath} with defaults?`)
            : true;
          if (!proceed) {
            yield* printHuman("Aborted. eas.json was not modified.");
            return { action: "aborted" as const, path: easJsonPath };
          }
          yield* writeEasJson(easJsonPath, DEFAULT_EAS_JSON);
          yield* printHuman(`Overwrote eas.json with default profiles.`);
          return {
            action: "overwritten" as const,
            path: easJsonPath,
            profiles: [...DEFAULT_PROFILES],
          };
        }

        const existingRaw = yield* fs
          .readFileString(easJsonPath)
          .pipe(
            Effect.mapError(
              (cause) =>
                new BuildProfileError({ message: `Failed to read eas.json: ${cause.message}` }),
            ),
          );
        const config = yield* parseEasConfig(existingRaw);

        const existingProfiles = Object.keys(config.build ?? {});
        const missing = DEFAULT_PROFILES.filter((name) => !existingProfiles.includes(name));

        if (missing.length === 0) {
          yield* printHuman(
            `eas.json already defines all default profiles (${existingProfiles.join(", ")}). Nothing to add.`,
          );
          yield* printHuman("Pass --force to overwrite with the default template.");
          return { action: "noop" as const, path: easJsonPath, existing: existingProfiles };
        }

        const proceed = interactive
          ? yield* promptConfirm(
              `Add missing profile(s) [${missing.join(", ")}] to existing eas.json?`,
              { initialValue: true },
            )
          : true;
        if (!proceed) {
          yield* printHuman("Aborted. eas.json was not modified.");
          return { action: "aborted" as const, path: easJsonPath };
        }

        const additions = Object.fromEntries(
          missing.map((name) => [name, DEFAULT_EAS_JSON.build[name]]),
        );
        const merged = {
          build: {
            ...config.build,
            ...additions,
          },
          ...compact({ cli: config.cli }),
        };
        yield* writeEasJson(easJsonPath, merged);
        yield* printHuman(`Added profile(s) to eas.json: ${missing.join(", ")}.`);
        yield* printHumanKeyValue([
          ["Existing", existingProfiles.join(", ") || "(none)"],
          ["Added", missing.join(", ")],
          ["Path", easJsonPath],
        ]);
        return {
          action: "topped-up" as const,
          path: easJsonPath,
          existing: existingProfiles,
          added: [...missing],
        };
      }),
      { json: "value" },
    ),
});
