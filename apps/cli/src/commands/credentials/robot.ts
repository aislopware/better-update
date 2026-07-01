import { defineCommand } from "citty";
import { Effect } from "effect";

import { createRobotAccount, rotateRobotAccountBearer } from "../../application/robot";
import { grantRecipient } from "../../application/vault-access";
import { currentRecipients, rotateVaultTo } from "../../application/vault-rotation";
import { runEffect } from "../../lib/citty-effect";
import { IdentityError } from "../../lib/exit-codes";
import {
  printHuman,
  printHumanKeyValue,
  printHumanList,
  printHumanTable,
  printKeyValue,
} from "../../lib/output";
import { serializeRobotEnv } from "../../lib/robot-env";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";
import { confirmRecipients, toRotationRecipient } from "./access";
import { unlockVaultInteractively } from "./vault-session";

const resolveName = (flag: string | undefined) =>
  Effect.gen(function* () {
    if (flag && flag.trim().length > 0) {
      return flag.trim();
    }
    const runtime = yield* CliRuntime;
    const userName = yield* runtime.userName;
    return `ci-${userName}`;
  });

const createCommand = defineCommand({
  meta: {
    name: "create",
    description:
      "Mint an org-owned robot account (bearer secret + vault identity) and print its BETTER_UPDATE_ROBOT credential once",
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
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const name = yield* resolveName(args.name);
        const robot = yield* createRobotAccount(api, name);

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

        return {
          id: robot.account.id,
          name: robot.account.name,
          granted,
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
        const { items } = yield* api["robot-accounts"].list();
        yield* printHumanList(
          ["Id", "Name", "Bearer", "Vault access", "Created"],
          items.map((robot) => [
            robot.id,
            robot.name,
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
      "Revoke a robot account: its bearer stops authenticating immediately; if it holds vault access, that is excluded and the vault is rotated too",
  },
  args: {
    id: { type: "positional", required: true, description: "Robot account id" },
    yes: { type: "boolean", description: "Skip the out-of-band fingerprint confirmation prompt" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const { items } = yield* api["robot-accounts"].list();
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

        yield* api["robot-accounts"].revoke({ path: { id: args.id } });
        yield* printHuman(`Revoked robot account ${robot.name} (${robot.id}).`);
        return { revoked: true, id: robot.id, vaultRevoked };
      }),
      { json: "value" },
    ),
});

const listPoliciesCommand = defineCommand({
  meta: { name: "policies", description: "List policies attached to a robot account" },
  args: {
    id: { type: "positional", required: true, description: "Robot account id" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const result = yield* api["policy-attachments"].listForRobot({ path: { id: args.id } });
        yield* printHumanTable(
          ["Attachment ID", "Policy ID", "Created"],
          result.items.map((attachment) => [
            attachment.id,
            attachment.policyId,
            attachment.createdAt,
          ]),
        );
        return result;
      }),
      { json: "value" },
    ),
});

const attachPolicyCommand = defineCommand({
  meta: {
    name: "attach",
    description: "Attach a policy (real or managed:*) to a robot account",
  },
  args: {
    id: { type: "positional", required: true, description: "Robot account id" },
    "policy-id": {
      type: "string",
      required: true,
      description: "Policy ID to attach (real id or managed preset like managed:admin)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const attachment = yield* api["policy-attachments"].attachToRobot({
          path: { id: args.id },
          payload: { policyId: args["policy-id"] },
        });
        yield* printHumanKeyValue([
          ["Attachment ID", attachment.id],
          ["Robot ID", attachment.principalId],
          ["Policy ID", attachment.policyId],
          ["Created", attachment.createdAt],
        ]);
        return attachment;
      }),
      { json: "value" },
    ),
});

const detachPolicyCommand = defineCommand({
  meta: { name: "detach", description: "Remove a policy attachment from a robot account" },
  args: {
    id: { type: "positional", required: true, description: "Robot account id" },
    "policy-id": {
      type: "string",
      required: true,
      description: "Policy ID to detach (real id or managed preset like managed:admin)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        yield* api["policy-attachments"].detachFromRobot({
          path: { id: args.id, policyId: encodeURIComponent(args["policy-id"]) },
        });
        yield* printHuman(`Detached policy ${args["policy-id"]} from robot account ${args.id}.`);
        return { robotId: args.id, policyId: args["policy-id"], detached: true };
      }),
      { json: "value" },
    ),
});

export const robotCommand = defineCommand({
  meta: {
    name: "robot",
    description: "Manage org-owned robot accounts (CI bearer auth + vault identity in one)",
  },
  subCommands: {
    create: createCommand,
    list: listCommand,
    rotate: rotateCommand,
    revoke: revokeCommand,
    policies: listPoliciesCommand,
    attach: attachPolicyCommand,
    detach: detachPolicyCommand,
  },
  default: "list",
});
