import AppleUtils from "@expo/apple-utils";
import { defineCommand } from "citty";
import { Effect, Either } from "effect";

import { createAscKeyViaLogin } from "../../application/asc-key-resolve";
import { buildTokenRequestContext, wrapConnect } from "../../lib/apple-asc-connect";
import { reconcilePortalSnapshot, toAppleDevice } from "../../lib/apple-device-roster";
import { fetchAscCredentials } from "../../lib/asc-credentials";
import { runEffect } from "../../lib/citty-effect";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";

import type { AppleDevice } from "../../lib/apple-device-roster";
import type { ApiClient } from "../../services/api-client";

const LIST_LIMIT = 100;

interface LocalDevice {
  readonly identifier: string;
  readonly name: string;
}

interface SyncTarget {
  readonly ascApiKeyId: string;
  readonly appleTeamId: string;
}

interface SyncArgs {
  readonly "apple-team-id"?: string | undefined;
  readonly "asc-api-key-id"?: string | undefined;
}

/**
 * Resolve which ASC key authenticates the sync and which internal team it
 * targets. Either flag suffices: an ASC key already carries its team, and a team
 * resolves to the ASC key uploaded for it.
 */
const resolveTarget = (api: ApiClient, args: SyncArgs) =>
  Effect.gen(function* () {
    const keyArg = args["asc-api-key-id"];
    const teamArg = args["apple-team-id"];
    const ascKeys = yield* api.ascApiKeys.list();

    if (keyArg !== undefined) {
      const match = ascKeys.items.find((key) => key.id === keyArg);
      if (match === undefined) {
        return yield* new InvalidArgumentError({
          message: `ASC API key "${keyArg}" not found in this organization.`,
        });
      }
      const appleTeamId = teamArg ?? match.appleTeamId;
      if (!appleTeamId) {
        return yield* new InvalidArgumentError({
          message: `ASC API key "${keyArg}" is not linked to an Apple team; pass --apple-team-id <uuid>.`,
        });
      }
      return { ascApiKeyId: keyArg, appleTeamId } satisfies SyncTarget;
    }

    if (teamArg !== undefined) {
      const match = ascKeys.items.find((key) => key.appleTeamId === teamArg);
      if (match !== undefined) {
        return { ascApiKeyId: match.id, appleTeamId: teamArg } satisfies SyncTarget;
      }
      // A fresh team has no key yet — offer to mint one from an Apple ID login
      // (the login picks the team, so verify the key landed on the target team).
      const created = yield* createAscKeyViaLogin(
        api,
        `No ASC API key stored for team "${teamArg}". Create one now from your Apple ID?`,
      ).pipe(Effect.orElseSucceed(() => null));
      if (created !== null) {
        const refreshed = yield* api.ascApiKeys.list();
        const onTeam = refreshed.items.some(
          (key) => key.id === created.id && key.appleTeamId === teamArg,
        );
        if (onTeam) {
          return { ascApiKeyId: created.id, appleTeamId: teamArg } satisfies SyncTarget;
        }
        yield* printHuman(
          `The created key ${created.keyId} belongs to a different Apple team than "${teamArg}".`,
        );
      }
      return yield* new InvalidArgumentError({
        message: `No ASC API key found for team "${teamArg}". Create one with \`better-update credentials generate asc-key\`, or import a .p8 with \`better-update credentials upload-asc-key\`.`,
      });
    }

    return yield* new InvalidArgumentError({
      message: "Pass --apple-team-id <uuid> or --asc-api-key-id <id> to choose what to sync.",
    });
  });

const listAllLocalDevices = (api: ApiClient, appleTeamId: string) =>
  Effect.gen(function* () {
    const items: LocalDevice[] = [];
    let page = 1;
    let fetched = 0;
    let total = Number.POSITIVE_INFINITY;
    // List across teams (no `appleTeamId` filter) so team-less devices are seen:
    // sync claims unassigned devices for the target team. Devices already on
    // another team are skipped — they are not this sync's to push or link.
    while (fetched < total) {
      const result = yield* api.devices.list({
        urlParams: { page, limit: LIST_LIMIT },
      });
      ({ total } = result);
      if (result.items.length === 0) {
        break;
      }
      fetched += result.items.length;
      for (const device of result.items) {
        if (device.appleTeamId === appleTeamId || device.appleTeamId === null) {
          items.push({ identifier: device.identifier, name: device.name });
        }
      }
      page += 1;
    }
    return items;
  });

export const syncDeviceCommand = defineCommand({
  meta: {
    name: "sync",
    description:
      "Sync devices with Apple App Store Connect: register local-only devices on Apple and import devices already registered there",
  },
  args: {
    "apple-team-id": {
      type: "string",
      description: "Internal team Id (UUID) to sync; derived from --asc-api-key-id if omitted",
    },
    "asc-api-key-id": {
      type: "string",
      description: "ASC API key to authenticate with; derived from --apple-team-id if omitted",
    },
    push: {
      type: "boolean",
      default: true,
      description: "Register local-only devices on Apple",
      negativeDescription: "Skip registering local devices on Apple (--no-push)",
    },
    pull: {
      type: "boolean",
      default: true,
      description: "Import Apple-registered devices into better-update",
      negativeDescription: "Skip importing Apple devices (--no-pull)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const target = yield* resolveTarget(api, args);

        const creds = yield* fetchAscCredentials(api, target.ascApiKeyId);
        const ctx = buildTokenRequestContext(creds);

        const appleDevices = (yield* wrapConnect("apple-list-devices", async () =>
          AppleUtils.Device.getAsync(ctx),
        )).map(toAppleDevice);
        const local = yield* listAllLocalDevices(api, target.appleTeamId);
        const localUdids = new Set(local.map((device) => device.identifier.toLowerCase()));

        // PUSH: register devices that exist locally but not yet on Apple. Each
        // create is isolated so one rejection (e.g. a stale/invalid UDID) does
        // not abort the rest of the sync.
        const pushed: AppleDevice[] = [];
        const pushFailures: { readonly identifier: string; readonly message: string }[] = [];
        if (args.push) {
          const appleUdids = new Set(appleDevices.map((device) => device.udid.toLowerCase()));
          const toPush = local.filter((device) => !appleUdids.has(device.identifier.toLowerCase()));
          for (const device of toPush) {
            const result = yield* Effect.either(
              wrapConnect("apple-create-device", async () =>
                AppleUtils.Device.createAsync(ctx, {
                  name: device.name,
                  udid: device.identifier,
                  platform: AppleUtils.BundleIdPlatform.IOS,
                }),
              ),
            );
            if (Either.isRight(result)) {
              pushed.push(toAppleDevice(result.right));
            } else {
              pushFailures.push({ identifier: device.identifier, message: result.left.message });
            }
          }
        }

        // Reconcile the Apple snapshot into our DB. When --no-pull, restrict to
        // UDIDs we already track so existing devices still get their portal id
        // linked, but Apple-only devices are not imported.
        const summary = yield* reconcilePortalSnapshot(
          api,
          target.appleTeamId,
          [...appleDevices, ...pushed].filter(
            (device) => args.pull || localUdids.has(device.udid.toLowerCase()),
          ),
        );

        yield* printHumanKeyValue([
          ["Apple devices", String(appleDevices.length + pushed.length)],
          ["Pushed to Apple", String(pushed.length)],
          ["Imported locally", String(summary.created)],
          ["Linked (portal id set)", String(summary.linked)],
          ["Already synced", String(summary.unchanged)],
        ]);
        for (const failure of pushFailures) {
          yield* printHuman(`⚠ Could not push ${failure.identifier} to Apple: ${failure.message}`);
        }

        return {
          appleTeamId: target.appleTeamId,
          pushed: pushed.length,
          ...summary,
          pushFailures,
        };
      }),
      { json: "value" },
    ),
});
