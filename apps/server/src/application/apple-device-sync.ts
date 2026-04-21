import { Effect } from "effect";
import { uniqBy } from "es-toolkit";

import { AppleAppStoreConnect } from "../cloudflare/apple-app-store-connect";
import { DeviceRepo } from "../repositories/devices";

import type {
  AppleApiError,
  AppleAuthError,
  AppleCredentials,
  AppleDevice,
  AppleNetworkError,
} from "../cloudflare/apple-app-store-connect";
import type { DeviceClass, DeviceModel } from "../models";

interface SyncedDeviceSummary {
  readonly id: string;
  readonly identifier: string;
  readonly name: string;
  readonly deviceClass: DeviceClass;
}

export interface SyncDevicesResult {
  readonly pulled: number;
  readonly pushed: number;
  readonly skipped: number;
  readonly devices: readonly SyncedDeviceSummary[];
}

const toLocalClass = (remote: AppleDevice["deviceClass"]): DeviceClass => {
  if (remote === "IPHONE" || remote === "IPAD" || remote === "MAC") {
    return remote;
  }
  return "UNKNOWN";
};

const toPlatform = (deviceClass: DeviceClass): "IOS" | "MAC_OS" =>
  deviceClass === "MAC" ? "MAC_OS" : "IOS";

const summarize = (device: DeviceModel): SyncedDeviceSummary => ({
  id: device.id,
  identifier: device.identifier,
  name: device.name,
  deviceClass: device.deviceClass,
});

interface PullOutcome {
  readonly kind: "skipped" | "pulled";
  readonly summary: SyncedDeviceSummary;
}

interface PushOutcome {
  readonly summary: SyncedDeviceSummary;
}

const pullRemote = (
  organizationId: string,
  appleTeamId: string,
  remote: AppleDevice,
  local: DeviceModel | undefined,
): Effect.Effect<PullOutcome, never, DeviceRepo> =>
  Effect.gen(function* () {
    const repo = yield* DeviceRepo;

    if (local) {
      if (local.appleDevicePortalId !== remote.id) {
        yield* repo.setApplePortalId({
          id: local.id,
          appleDevicePortalId: remote.id,
          updatedAt: new Date().toISOString(),
        });
      }
      return { kind: "skipped", summary: summarize(local) };
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const deviceClass = toLocalClass(remote.deviceClass);
    const identifier = remote.udid.toLowerCase();

    yield* repo
      .insert({
        id,
        organizationId,
        appleTeamId,
        identifier,
        name: remote.name,
        model: remote.model,
        deviceClass,
        enabled: remote.status === "ENABLED",
        appleDevicePortalId: remote.id,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.catchTag("Conflict", () => Effect.succeed(undefined)));

    return {
      kind: "pulled",
      summary: { id, identifier, name: remote.name, deviceClass },
    };
  });

const pushLocal = (
  credentials: AppleCredentials,
  local: DeviceModel,
): Effect.Effect<
  PushOutcome,
  AppleApiError | AppleAuthError | AppleNetworkError,
  AppleAppStoreConnect | DeviceRepo
> =>
  Effect.gen(function* () {
    const apple = yield* AppleAppStoreConnect;
    const repo = yield* DeviceRepo;

    const registered = yield* apple.registerDevice(credentials, {
      name: local.name,
      udid: local.identifier,
      platform: toPlatform(local.deviceClass),
    });

    yield* repo.setApplePortalId({
      id: local.id,
      appleDevicePortalId: registered.id,
      updatedAt: new Date().toISOString(),
    });

    return { summary: summarize(local) };
  });

export const syncDevices = (params: {
  readonly organizationId: string;
  readonly appleTeamId: string;
  readonly credentials: AppleCredentials;
}): Effect.Effect<
  SyncDevicesResult,
  AppleApiError | AppleAuthError | AppleNetworkError,
  AppleAppStoreConnect | DeviceRepo
> =>
  Effect.gen(function* () {
    const apple = yield* AppleAppStoreConnect;
    const repo = yield* DeviceRepo;

    const [remoteDevices, localDevices] = yield* Effect.all(
      [
        apple.listDevices(params.credentials),
        repo.findAllByOrg({
          organizationId: params.organizationId,
          appleTeamId: params.appleTeamId,
        }),
      ],
      { concurrency: "unbounded" },
    );

    const localByUdid = new Map(
      localDevices.map((device) => [device.identifier.toLowerCase(), device] as const),
    );
    const remoteByUdid = new Map(
      remoteDevices.map((device) => [device.udid.toLowerCase(), device] as const),
    );

    const devicesToPush = localDevices.filter(
      (local) =>
        local.appleDevicePortalId === null && !remoteByUdid.has(local.identifier.toLowerCase()),
    );

    const [pullOutcomes, pushOutcomes] = yield* Effect.all(
      [
        Effect.forEach(
          remoteDevices,
          (remote) =>
            pullRemote(
              params.organizationId,
              params.appleTeamId,
              remote,
              localByUdid.get(remote.udid.toLowerCase()),
            ),
          { concurrency: 1 },
        ),
        Effect.forEach(devicesToPush, (local) => pushLocal(params.credentials, local), {
          concurrency: 1,
        }),
      ],
      { concurrency: "unbounded" },
    );

    const pulled = pullOutcomes.filter((outcome) => outcome.kind === "pulled").length;
    const skipped = pullOutcomes.length - pulled;
    const pushed = pushOutcomes.length;

    const summaries = uniqBy(
      [...pullOutcomes, ...pushOutcomes].map((outcome) => outcome.summary),
      (summary) => summary.id,
    );

    return { pulled, pushed, skipped, devices: summaries };
  });
