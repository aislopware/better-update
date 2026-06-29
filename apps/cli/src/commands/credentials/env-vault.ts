import { defineCommand } from "citty";
import { Effect } from "effect";

import { cutoverEnvVault } from "../../application/env-vault-cutover";
import { rotateEnvVault } from "../../application/env-vault-rotation";
import { runEffect } from "../../lib/citty-effect";
import { printHuman, printKeyValue } from "../../lib/output";
import { promptConfirm } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";

const migrateCommand = defineCommand({
  meta: {
    name: "migrate",
    description:
      "Fork env values into a separate env vault so they can be unlocked from the browser (one-time, admin)",
  },
  args: {
    yes: { type: "boolean", description: "Skip the confirmation prompt" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        yield* printHuman(
          "Migrating splits env values into their own end-to-end-encrypted vault, wrapped to every device and account key.",
        );
        yield* printHuman(
          "⚠  This is one-shot per organization. Until they upgrade, older CLIs can no longer READ env values (credentials are unaffected).",
        );
        yield* printHuman(
          "⚠  Avoid env-var writes (set/push/import/update) elsewhere while this runs — a value written mid-migration may need re-setting afterwards.",
        );
        const proceed =
          args.yes === true ||
          (yield* promptConfirm("Migrate this organization's env values to a separate vault now?", {
            initialValue: false,
          }));
        if (!proceed) {
          yield* printHuman("Aborted — no changes made.");
          return { migrated: false };
        }
        const vault = yield* cutoverEnvVault(api);
        yield* printHuman(`✓ Env vault created (version ${String(vault.envVaultVersion)}).`);
        yield* printHuman(
          "Members enroll browser access with `better-update credentials account create`.",
        );
        return { migrated: true, envVaultVersion: vault.envVaultVersion };
      }),
      { json: "value" },
    ),
});

const rotateCommand = defineCommand({
  meta: {
    name: "rotate",
    description:
      "Rotate the env-vault key, re-wrapping to the current recipients — clears a pending flag after a member is removed (admin)",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const vault = yield* rotateEnvVault(api);
        yield* printHuman(`Rotated the env vault to version ${String(vault.envVaultVersion)}.`);
        return { envVaultVersion: vault.envVaultVersion };
      }),
      { json: "value" },
    ),
});

const statusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Show whether the org has cut over to a separate env vault, and its version/state",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const vault = yield* api.orgVault
          .get()
          .pipe(Effect.catchTag("NotFound", () => Effect.succeed(null)));
        if (vault === null) {
          yield* printHuman("This organization has no credential vault yet.");
          return { vaultExists: false };
        }
        const cutOver = vault.envVaultCutoverAt !== null;
        yield* printKeyValue([
          ["Env vault", cutOver ? "separate (migrated)" : "shared with credentials vault"],
          ["Env vault version", cutOver ? String(vault.envVaultVersion) : "—"],
          ["Env rotation pending", vault.envRotationPending ? "yes" : "no"],
        ]);
        if (vault.envRotationPending) {
          yield* printHuman(
            "⚠ Env rotation pending — run `better-update credentials env-vault rotate` to re-key and restore env access.",
          );
        }
        return {
          vaultExists: true,
          cutOver,
          envVaultVersion: cutOver ? vault.envVaultVersion : null,
          envRotationPending: vault.envRotationPending,
        };
      }),
      { json: "value" },
    ),
});

export const envVaultCommand = defineCommand({
  meta: {
    name: "env-vault",
    description: "Manage the organization's separate env-vault (migrate, rotate, status)",
  },
  subCommands: {
    migrate: migrateCommand,
    rotate: rotateCommand,
    status: statusCommand,
  },
  default: "status",
});
