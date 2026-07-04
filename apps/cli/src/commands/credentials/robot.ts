import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  forgetCachedEnvVaultKey,
  grantEnvRecipient,
  orgHasCutOver,
  unlockEnvVaultKeyInteractive,
} from "../../application/env-vault-access";
import { rotateEnvVault } from "../../application/env-vault-rotation";
import { createRobotAccount, rotateRobotAccountBearer } from "../../application/robot";
import { grantRecipient } from "../../application/vault-access";
import { currentRecipients, rotateVaultTo } from "../../application/vault-rotation";
import { runEffect } from "../../lib/citty-effect";
import { IdentityError } from "../../lib/exit-codes";
import { formatCause } from "../../lib/format-error";
import { printHuman, printHumanList, printKeyValue } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { parseProjectRole } from "../../lib/project-roles";
import { serializeRobotEnv } from "../../lib/robot-env";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";
import { confirmRecipients, toRotationRecipient } from "./access";
import { unlockVaultInteractively } from "./vault-session";

import type { ApiClient } from "../../services/api-client";

const resolveName = (flag: string | undefined) =>
  Effect.gen(function* () {
    if (flag && flag.trim().length > 0) {
      return flag.trim();
    }
    const runtime = yield* CliRuntime;
    const userName = yield* runtime.userName;
    return `ci-${userName}`;
  });

/**
 * Wrap the env-vault key to a robot's machine key from this device. Post-cutover
 * only — before it, env values are sealed under the credentials vault, so a
 * credentials-vault grant already covers them. The caller must itself be an env
 * recipient (its device wrap unlocks the key being re-wrapped).
 */
const grantRobotEnvAccess = (api: ApiClient, userEncryptionKeyId: string | null) =>
  Effect.gen(function* () {
    const { items } = yield* api.userEncryptionKeys.list();
    const target = items.find((key) => key.id === userEncryptionKeyId);
    if (target === undefined) {
      return yield* new IdentityError({ message: "Robot's vault identity was not found." });
    }
    const ev = yield* unlockEnvVaultKeyInteractive(api);
    yield* grantEnvRecipient({ api, vault: ev, target });
  });

/** `true` while the robot's machine key holds a wrap on the CURRENT env vault. */
const robotHoldsEnvWrap = (api: ApiClient, keyId: string) =>
  api.envVault.listWraps().pipe(
    Effect.map(({ recipients }) =>
      recipients.some((wrap) => wrap.recipientKind !== "account" && wrap.recipientId === keyId),
    ),
    Effect.catchTag("NotFound", () => Effect.succeed(false)),
  );

/**
 * If the robot's machine key holds an env wrap, rotate the env vault to a new key
 * it never receives (the exclude-and-rotate `revoke` drives for the credentials
 * vault, on the env side). Returns whether an env revocation actually happened.
 */
const revokeRobotEnvAccess = (api: ApiClient, keyId: string) =>
  Effect.gen(function* () {
    if (!(yield* robotHoldsEnvWrap(api, keyId))) {
      return false;
    }
    const rotated = yield* rotateEnvVault(api, { excludeKeyId: keyId });
    yield* printHuman(
      `Revoked env-vault access and rotated the env vault to version ${String(rotated.envVaultVersion)}.`,
    );
    return true;
  });

/** `--project` flag when given, else the linked project from the local context. */
const resolveProjectId = (flag: string | undefined) => {
  const value = flag?.trim();
  if (value !== undefined && value.length > 0) {
    return Effect.succeed(value);
  }
  return readProjectId.pipe(
    Effect.mapError(
      () =>
        new IdentityError({
          message:
            "A robot lives on exactly one project — pass --project <projectId> or run this inside a linked project.",
        }),
    ),
  );
};

/**
 * Best-effort id→name map from the first page of the org's projects. A robot
 * listing must never fail because of a cosmetic lookup, so errors (and names
 * beyond the first 100 projects) simply fall back to the raw project id.
 */
const projectNamesById = (api: ApiClient) =>
  api.projects.list({ urlParams: { page: 1, limit: 100, sort: "lastActivityAt" } }).pipe(
    Effect.map((result) => new Map(result.items.map((project) => [project.id, project.name]))),
    Effect.orElseSucceed(() => new Map<string, string>()),
  );

const createCommand = defineCommand({
  meta: {
    name: "create",
    description:
      "Mint a project-scoped robot account (bearer secret + vault identity) and print its BETTER_UPDATE_ROBOT credential once",
  },
  args: {
    name: {
      type: "string",
      description: 'Human name for this robot (defaults to "ci-<your username>")',
    },
    grant: {
      type: "boolean",
      default: true,
      description: "Also grant the new robot vault access from this device",
      negativeDescription:
        "Register the robot's vault identity without granting it (grant later with `credentials access grant`)",
    },
    project: {
      type: "string",
      description:
        "Project this robot belongs to (defaults to the linked project from the local context)",
    },
    role: {
      type: "string",
      default: "developer",
      description:
        'Project role fixed at creation: "maintainer", "developer" (default), or "reporter"',
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const name = yield* resolveName(args.name);
        const projectId = yield* resolveProjectId(args.project);
        const role = yield* parseProjectRole(args.role);
        const robot = yield* createRobotAccount(api, name, { projectId, role });

        // Show the bundled credential BEFORE attempting the grant: it is the one
        // output that must never be lost (the bearer + private key are never
        // stored), so it prints even if the grant path below fails or is skipped.
        const bundle = serializeRobotEnv({
          bearer: robot.bearerSecret,
          identity: robot.identityPrivateKey,
        });
        yield* printKeyValue([
          ["Name", robot.account.name],
          ["Id", robot.account.id],
          ["Project", robot.account.projectId],
          ["Role", robot.account.role],
        ]);
        yield* printHuman("");
        yield* printHuman(
          "⚠  The credential below is shown ONCE and is never stored. Save it now as the",
        );
        yield* printHuman(
          "   masked + protected CI variable BETTER_UPDATE_ROBOT. Every runner reuses it — nothing",
        );
        yield* printHuman(
          "   is generated on the runner, and `credentials robot revoke` shuts it off.",
        );
        yield* printHuman("");
        yield* printKeyValue([["BETTER_UPDATE_ROBOT", bundle]]);
        yield* printHuman("");

        // The keypair was generated in-process a moment ago, so there is no
        // third-party public key to verify out-of-band — unlike `access grant`,
        // we grant it directly (no fingerprint confirmation). A soft IdentityError
        // (no vault yet, or this device isn't a recipient) leaves it registered
        // but ungranted with guidance, rather than losing the just-printed bundle.
        const granted = args.grant
          ? yield* unlockVaultInteractively(api).pipe(
              Effect.flatMap((vault) =>
                Effect.gen(function* () {
                  const { items } = yield* api.userEncryptionKeys.list();
                  const target = items.find((key) => key.id === robot.account.userEncryptionKeyId);
                  if (target === undefined) {
                    return yield* new IdentityError({
                      message: "Robot's vault identity was not found after registration.",
                    });
                  }
                  yield* grantRecipient({ api, vault, target });
                }),
              ),
              Effect.as(true),
              Effect.catchTag("IdentityError", (error) =>
                printHuman(
                  `⚠ Registered but not granted: ${error.message}\n` +
                    `  An admin can grant it later: better-update credentials access grant ${robot.account.id}`,
                ).pipe(Effect.as(false)),
              ),
            )
          : false;

        yield* printHuman(
          granted
            ? `✓ Granted vault access to ${robot.account.name} — this robot reads credentials non-interactively.`
            : `Registered ${robot.account.name}'s vault identity (not yet a vault member).`,
        );

        // Post-cutover the env vault is a SEPARATE key, so the credentials-vault
        // grant above does not cover env decryption — self-link the robot as an
        // env recipient too (this device wraps the env key it can already unlock).
        // Pre-cutover env is sealed under the credentials vault: nothing extra to
        // grant, so `envGranted` stays false without a warning.
        const envGranted =
          args.grant && (yield* orgHasCutOver(api))
            ? yield* grantRobotEnvAccess(api, robot.account.userEncryptionKeyId).pipe(
                Effect.as(true),
                // Best-effort: NOTHING here may sink the command — a JSON
                // consumer only receives the one-time bundle from the return
                // value. Any failure (missing key, stale env version, API
                // error) degrades to a warning + the grant-env hand-off.
                Effect.catchAll((error) =>
                  printHuman(
                    `⚠ Env vault not granted: ${formatCause(error)}\n` +
                      `  An admin can grant it later: better-update credentials robot grant-env ${robot.account.id}`,
                  ).pipe(Effect.as(false)),
                ),
              )
            : false;
        if (envGranted) {
          yield* printHuman(
            `✓ Granted env-vault access to ${robot.account.name} — it decrypts env vars non-interactively.`,
          );
        }

        return {
          id: robot.account.id,
          name: robot.account.name,
          projectId: robot.account.projectId,
          role: robot.account.role,
          granted,
          envGranted,
          // Shown once: JSON consumers must capture this now (mirrors human output).
          robotEnv: bundle,
        };
      }),
      { json: "value" },
    ),
});

const listCommand = defineCommand({
  meta: { name: "list", description: "List this organization's robot accounts" },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const { items } = yield* api["robot-accounts"].list({ urlParams: {} });
        const projectNames = yield* projectNamesById(api);
        // "Vault identity" (not "access"): a registered identity may not have
        // been GRANTED the vault yet — actual membership is `credentials access list`.
        yield* printHumanList(
          ["Id", "Name", "Project", "Role", "Bearer", "Vault identity", "Created"],
          items.map((robot) => [
            robot.id,
            robot.name,
            // A NULL project marks a pre-v2 org-scoped robot: it can no longer
            // authenticate (the server requires a project) and exists to be revoked.
            robot.projectId === null
              ? "legacy — recreate"
              : (projectNames.get(robot.projectId) ?? robot.projectId),
            robot.role ?? "—",
            robot.bearerStart === null ? "— not minted —" : `${robot.bearerStart}···`,
            robot.userEncryptionKeyId === null ? "no" : "yes",
            robot.createdAt,
          ]),
          "No robot accounts yet — create one with `better-update credentials robot create`.",
        );
        return { items };
      }),
      { json: "value" },
    ),
});

const rotateCommand = defineCommand({
  meta: {
    name: "rotate",
    description:
      "Re-mint a robot account's bearer secret; any linked vault identity is left untouched",
  },
  args: {
    id: { type: "positional", required: true, description: "Robot account id" },
    identity: {
      type: "string",
      description:
        "This robot's current age private key (from its original BETTER_UPDATE_ROBOT or BETTER_UPDATE_IDENTITY secret) — combines with the new bearer into a full BETTER_UPDATE_ROBOT credential. Omit to print the bearer alone",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const rotated = yield* rotateRobotAccountBearer(api, args.id);
        if (args.identity && args.identity.trim().length > 0) {
          const bundle = serializeRobotEnv({
            bearer: rotated.bearerSecret,
            identity: args.identity.trim(),
          });
          yield* printKeyValue([["BETTER_UPDATE_ROBOT", bundle]]);
          return { id: args.id, robotEnv: bundle };
        }
        yield* printHuman(
          "New bearer secret (this robot's vault identity, if any, is unchanged — combine with " +
            "its existing private key yourself, or re-run with --identity to get a full bundle):",
        );
        yield* printKeyValue([["Bearer secret", rotated.bearerSecret]]);
        return { id: args.id, bearerSecret: rotated.bearerSecret };
      }),
      { json: "value" },
    ),
});

const revokeCommand = defineCommand({
  meta: {
    name: "revoke",
    description:
      "Revoke a robot account: its bearer stops authenticating immediately; if it holds vault or env-vault access, it is excluded and the vault(s) rotated too",
  },
  args: {
    id: { type: "positional", required: true, description: "Robot account id" },
    yes: { type: "boolean", description: "Skip the out-of-band fingerprint confirmation prompt" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const { items } = yield* api["robot-accounts"].list({ urlParams: {} });
        const robot = items.find((item) => item.id === args.id);
        if (robot === undefined) {
          return yield* new IdentityError({ message: `No robot account matches id "${args.id}".` });
        }

        let vaultRevoked = false;
        if (robot.userEncryptionKeyId !== null) {
          const recipients = yield* currentRecipients(api);
          const target = recipients.find((key) => key.id === robot.userEncryptionKeyId);
          if (target !== undefined) {
            const surviving = recipients.filter((key) => key.id !== target.id);
            if (!surviving.some((key) => key.kind === "recovery")) {
              return yield* new IdentityError({
                message:
                  "Refusing to revoke this robot — it would leave the vault without its offline recovery recipient. Rotate recovery first with `credentials access recovery rotate`.",
              });
            }
            yield* confirmRecipients(surviving, args.yes === true);
            const rotated = yield* rotateVaultTo({
              api,
              recipients: surviving.map(toRotationRecipient),
            });
            yield* printHuman(
              `Revoked vault access and rotated the vault to version ${String(rotated.vaultVersion)}.`,
            );
            vaultRevoked = true;
          }
        }

        // The env vault (post-cutover) is keyed separately, so an env-recipient
        // robot needs its own exclude-and-rotate — no fingerprint confirmation:
        // the surviving set was just confirmed above (or includes account keys,
        // which carry no out-of-band fingerprint to check).
        const envRevoked =
          robot.userEncryptionKeyId !== null && (yield* orgHasCutOver(api))
            ? yield* revokeRobotEnvAccess(api, robot.userEncryptionKeyId)
            : false;

        yield* api["robot-accounts"].revoke({ path: { id: args.id } });
        yield* printHuman(`Revoked robot account ${robot.name} (${robot.id}).`);
        return { revoked: true, id: robot.id, vaultRevoked, envRevoked };
      }),
      { json: "value" },
    ),
});

const grantEnvCommand = defineCommand({
  meta: {
    name: "grant-env",
    description:
      "Grant an existing robot access to the env vault so it can decrypt env vars in CI (post-cutover orgs — before the cutover a credentials-vault grant already covers env)",
  },
  args: {
    id: { type: "positional", required: true, description: "Robot account id" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const { items } = yield* api["robot-accounts"].list({ urlParams: {} });
        const robot = items.find((item) => item.id === args.id);
        if (robot === undefined) {
          return yield* new IdentityError({ message: `No robot account matches id "${args.id}".` });
        }
        if (robot.userEncryptionKeyId === null) {
          return yield* new IdentityError({
            message:
              "This robot has no vault identity to grant — revoke it and mint a replacement with `credentials robot create`.",
          });
        }
        if (!(yield* orgHasCutOver(api))) {
          return yield* new IdentityError({
            message:
              "This organization's env values are still sealed under the credentials vault (no env cutover) — a credentials-vault grant already covers env; nothing to do.",
          });
        }
        const keyId = robot.userEncryptionKeyId;
        // Idempotent, but `addWrap` answers Conflict for BOTH a duplicate wrap
        // and a stale `envVaultVersion` (a cached env key outlives rotations
        // made from other devices). Only report "already" when the wrap really
        // exists — otherwise drop the stale cache and grant once more against
        // the freshly-fetched version.
        const outcome = yield* grantRobotEnvAccess(api, keyId).pipe(
          Effect.as("granted" as const),
          Effect.catchTag("Conflict", () =>
            Effect.gen(function* () {
              if (yield* robotHoldsEnvWrap(api, keyId)) {
                return "already" as const;
              }
              yield* forgetCachedEnvVaultKey;
              yield* grantRobotEnvAccess(api, keyId);
              return "granted" as const;
            }),
          ),
        );
        yield* printHuman(
          outcome === "granted"
            ? `✓ Granted env-vault access to ${robot.name} — it decrypts env vars non-interactively.`
            : `${robot.name} is already an env-vault recipient — nothing to do.`,
        );
        return {
          id: robot.id,
          name: robot.name,
          envGranted: true,
          alreadyGranted: outcome === "already",
        };
      }),
      { json: "value" },
    ),
});

export const robotCommand = defineCommand({
  meta: {
    name: "robot",
    description:
      "Manage project-scoped robot accounts (CI bearer auth + vault identity in one; one robot = one project + one role)",
  },
  subCommands: {
    create: createCommand,
    list: listCommand,
    rotate: rotateCommand,
    revoke: revokeCommand,
    "grant-env": grantEnvCommand,
  },
  default: "list",
});
