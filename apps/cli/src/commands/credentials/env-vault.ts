import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { rotateEnvVault } from "../../application/env-vault-rotation";
import { printHuman, printKeyValue } from "../../lib/output";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

const rotateCommand = Command.make(
  "rotate",
  {},
  Effect.fn(
    function* () {
      const api = yield* apiClient;
      const vault = yield* rotateEnvVault(api);
      yield* printHuman(`Rotated the env vault to version ${String(vault.envVaultVersion)}.`);
      return { envVaultVersion: vault.envVaultVersion };
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Rotate the env-vault key, re-wrapping to the current recipients — clears a pending flag after a member is removed (admin)",
  ),
);

const statusHandler = Effect.fn(
  function* () {
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
  },
  runCommand({ json: "value" }),
);

const statusCommand = Command.make("status", {}, statusHandler).pipe(
  Command.withDescription(
    "Show whether the org has cut over to a separate env vault, and its version/state",
  ),
);

export const envVaultCommand = Command.make("env-vault", {}, statusHandler).pipe(
  Command.withDescription("Manage the organization's env-vault (rotate, status)"),
  Command.withSubcommands([rotateCommand, statusCommand]),
);
