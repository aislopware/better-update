import { existsSync, readFileSync, writeFileSync } from "node:fs";
import nodePath from "node:path";

import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../lib/citty-effect";
import { InvalidArgumentError } from "../lib/exit-codes";
import { printHuman } from "../lib/output";
import { promptConfirm } from "../lib/prompts";
import { CliRuntime } from "../services/cli-runtime";

interface LegacyTemplate {
  readonly expo?: {
    readonly extra?: {
      readonly betterUpdate?: {
        readonly profiles?: unknown;
        readonly [key: string]: unknown;
      };
      readonly [key: string]: unknown;
    };
    readonly [key: string]: unknown;
  };
}

const readAppJson = (projectRoot: string): LegacyTemplate | null => {
  const path = nodePath.join(projectRoot, "app.json");
  if (!existsSync(path)) {
    return null;
  }
  const raw = readFileSync(path, "utf8");
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- narrowing JSON.parse result; downstream code only reads known optional shape
  return JSON.parse(raw) as LegacyTemplate;
};

const writeAppJson = (projectRoot: string, content: unknown): void => {
  writeFileSync(nodePath.join(projectRoot, "app.json"), `${JSON.stringify(content, null, 2)}\n`);
};

const writeEasJson = (projectRoot: string, profiles: unknown): void => {
  writeFileSync(
    nodePath.join(projectRoot, "eas.json"),
    `${JSON.stringify({ build: profiles }, null, 2)}\n`,
  );
};

export const migrateConfigCommand = defineCommand({
  meta: {
    name: "migrate-config",
    description:
      "Migrate legacy `extra.betterUpdate.profiles` (in app.json) to a sibling `eas.json` file",
  },
  args: {
    yes: { type: "boolean", description: "Skip the confirmation prompt" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const runtime = yield* CliRuntime;
        const root = yield* runtime.cwd;
        const appJson = readAppJson(root);
        if (!appJson) {
          return yield* new InvalidArgumentError({
            message: `No app.json found at ${root}.`,
          });
        }
        const profiles = appJson.expo?.extra?.betterUpdate?.profiles;
        if (profiles === undefined) {
          yield* printHuman(
            "No legacy `extra.betterUpdate.profiles` found in app.json — nothing to migrate.",
          );
          return undefined;
        }
        if (existsSync(nodePath.join(root, "eas.json"))) {
          return yield* new InvalidArgumentError({
            message:
              "eas.json already exists. Manual review required — refusing to overwrite. Remove eas.json first if you want to regenerate.",
          });
        }
        if (!args.yes) {
          const confirmed = yield* promptConfirm(
            `Move profiles to eas.json and strip from app.json?`,
            { initialValue: true },
          );
          if (!confirmed) {
            yield* printHuman("Cancelled.");
            return undefined;
          }
        }
        writeEasJson(root, profiles);
        // Strip profiles, keeping any other betterUpdate fields (e.g. projectId).
        const clone = structuredClone(appJson);
        const extra = clone.expo?.extra;
        const betterUpdate = extra?.betterUpdate as Record<string, unknown> | undefined;
        if (betterUpdate) {
          delete betterUpdate["profiles"];
        }
        writeAppJson(root, clone);
        yield* printHuman("Migrated profiles into eas.json. Legacy field removed from app.json.");
        return undefined;
      }),
    ),
});
