import nodePath from "node:path";

import { compact } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { readBetterUpdateConfig, writeBetterUpdateConfig } from "../lib/better-update-config";
import { runEffect } from "../lib/citty-effect";
import { readEasJson } from "../lib/eas-config";
import { InvalidArgumentError } from "../lib/exit-codes";
import { printHuman } from "../lib/output";
import { promptConfirm } from "../lib/prompts";
import { CliRuntime } from "../services/cli-runtime";

export const migrateConfigCommand = defineCommand({
  meta: {
    name: "migrate-config",
    description: "Migrate `build`/`submit` profiles from a legacy eas.json into better-update.json",
  },
  args: {
    yes: { type: "boolean", description: "Skip the confirmation prompt" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const runtime = yield* CliRuntime;
        const fs = yield* FileSystem.FileSystem;
        const root = yield* runtime.cwd;

        const easPath = nodePath.join(root, "eas.json");
        const hasEas = yield* fs.exists(easPath).pipe(Effect.orElseSucceed(() => false));
        if (!hasEas) {
          return yield* new InvalidArgumentError({ message: `No eas.json found at ${root}.` });
        }

        const config = yield* readEasJson(root);
        const patch = compact({ build: config.build, submit: config.submit, cli: config.cli });
        if (Object.keys(patch).length === 0) {
          yield* printHuman("eas.json has no build/submit/cli sections — nothing to migrate.");
          return undefined;
        }

        const existing = yield* readBetterUpdateConfig(root);
        const existingBuild = existing?.["build"];
        const wouldOverwrite =
          typeof existingBuild === "object" && existingBuild !== null && config.build !== undefined;
        if (wouldOverwrite && !args.yes) {
          const confirmed = yield* promptConfirm(
            "better-update.json already has a build section — overwrite it from eas.json?",
            { initialValue: false },
          );
          if (!confirmed) {
            yield* printHuman("Cancelled.");
            return undefined;
          }
        }

        yield* writeBetterUpdateConfig(root, patch);
        yield* printHuman(
          "Merged eas.json build/submit into better-update.json. You can now delete eas.json.",
        );
        return undefined;
      }),
    ),
});
