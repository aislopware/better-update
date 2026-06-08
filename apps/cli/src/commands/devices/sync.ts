import { defineCommand } from "citty";
import { Effect, Either } from "effect";

import { createDevice, listDevices } from "../../lib/apple-asc-client";
import { fetchAscCredentials } from "../../lib/asc-credentials";
import { runEffect } from "../../lib/citty-effect";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";

import type { AscCredentials, AscDevice, AscError } from "../../lib/apple-asc-client";
import type { ApiClient } from "../../services/api-client";

type DeviceClass = "IPHONE" | "IPAD" | "MAC" | "UNKNOWN";

// Mirrors the server's DeviceIdentifier pattern so Apple-supplied UDIDs that our
// schema would reject (exotic device classes, malformed values) are skipped with
// a warning instead of failing the whole sync payload.
const IDENTIFIER_PATTERN =
  /^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{8}-[A-Fa-f0-9]{16}|[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12})$/u;

const APPLE_DEVICE_CLASS: Record<string, DeviceClass> = {
  IPHONE: "IPHONE",
  IPAD: "IPAD",
  MAC: "MAC",
};

const toDeviceClass = (raw: string | null): DeviceClass =>
  raw === null ? "UNKNOWN" : (APPLE_DEVICE_CLASS[raw] ?? "UNKNOWN");

const ascErrorMessage = (error: AscError): string =>
  error._tag === "AscApiError" ? error.message : `Apple request failed: ${String(error.cause)}`;

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
      if (match === undefined) {
        return yield* new InvalidArgumentError({
          message: `No ASC API key found for team "${teamArg}". Upload one with \`better-update credentials upload-asc-key\`.`,
        });
      }
      return { ascApiKeyId: match.id, appleTeamId: teamArg } satisfies SyncTarget;
    }

    return yield* new InvalidArgumentError({
      message: "Pass --apple-team-id <uuid> or --asc-api-key-id <id> to choose what to sync.",
    });
  });

const listAllLocalDevices = (api: ApiClient, appleTeamId: string) =>
  Effect.gen(function* () {
    const items: LocalDevice[] = [];
    let page = 1;
    let total = Number.POSITIVE_INFINITY;
    while (items.length < total) {
      const result = yield* api.devices.list({
        urlParams: { appleTeamId, page, limit: LIST_LIMIT },
      });
      ({ total } = result);
      if (result.items.length === 0) {
        break;
      }
      items.push(...result.items);
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
        const ascCreds: AscCredentials = {
          keyId: creds.keyId,
          issuerId: creds.issuerId,
          p8Pem: creds.p8Pem,
        };

        const appleDevices = yield* listDevices(ascCreds);
        const local = yield* listAllLocalDevices(api, target.appleTeamId);
        const localUdids = new Set(local.map((device) => device.identifier.toLowerCase()));

        // PUSH: register devices that exist locally but not yet on Apple. Each
        // create is isolated so one rejection (e.g. a stale/invalid UDID) does
        // not abort the rest of the sync.
        const pushed: AscDevice[] = [];
        const pushFailures: { readonly identifier: string; readonly message: string }[] = [];
        if (args.push) {
          const appleUdids = new Set(appleDevices.map((device) => device.udid.toLowerCase()));
          const toPush = local.filter((device) => !appleUdids.has(device.identifier.toLowerCase()));
          for (const device of toPush) {
            const result = yield* Effect.either(
              createDevice(ascCreds, { name: device.name, udid: device.identifier }),
            );
            if (Either.isRight(result)) {
              pushed.push(result.right);
            } else {
              pushFailures.push({
                identifier: device.identifier,
                message: ascErrorMessage(result.left),
              });
            }
          }
        }

        // Reconcile the Apple snapshot into our DB. When --no-pull, restrict to
        // UDIDs we already track so existing devices still get their portal id
        // linked, but Apple-only devices are not imported.
        const reconcileEntries = [...appleDevices, ...pushed]
          .filter((device) => args.pull || localUdids.has(device.udid.toLowerCase()))
          .filter((device) => IDENTIFIER_PATTERN.test(device.udid) && device.name.length > 0)
          .map((device) => ({
            identifier: device.udid,
            name: device.name.slice(0, 120),
            deviceClass: toDeviceClass(device.deviceClass),
            appleDevicePortalId: device.id,
          }));

        const summary =
          reconcileEntries.length > 0
            ? yield* api.devices.syncDevices({
                payload: { appleTeamId: target.appleTeamId, devices: reconcileEntries },
              })
            : { created: 0, linked: 0, unchanged: 0 };

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
