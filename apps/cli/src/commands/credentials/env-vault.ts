import { defineCommand } from "citty";
import { Effect } from "effect";

import { rotateEnvVault } from "../../application/env-vault-rotation";
import { runEffect } from "../../lib/citty-effect";
import { printHuman, printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";

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
    description: "Manage the organization's env-vault (rotate, status)",
  },
  subCommands: {
    rotate: rotateCommand,
    status: statusCommand,
  },
  default: "status",
});
