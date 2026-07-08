/**
 * Shared Apple-device roster plumbing for `devices sync` and provisioning
 * profile generation: mapping ASC portal records to backend rows and
 * pull-reconciling a portal snapshot into the backend so both sides fingerprint
 * the same roster.
 */
import AppleUtils from "@expo/apple-utils";
import { Effect, Either } from "effect";

import { wrapConnect } from "./apple-asc-connect";

import type { ApiClient } from "../services/api-client";

export type LocalDeviceClass = "IPHONE" | "IPAD" | "MAC" | "UNKNOWN";

// Mirrors the server's DeviceIdentifier pattern so Apple-supplied UDIDs that our
// schema would reject (exotic device classes, malformed values) are skipped with
// a warning instead of failing the whole sync payload.
export const APPLE_UDID_PATTERN =
  /^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{8}-[A-Fa-f0-9]{16}|[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12})$/u;

const APPLE_DEVICE_CLASS: Record<string, LocalDeviceClass> = {
  IPHONE: "IPHONE",
  IPAD: "IPAD",
  MAC: "MAC",
};

export const toDeviceClass = (raw: string | null): LocalDeviceClass =>
  raw === null ? "UNKNOWN" : (APPLE_DEVICE_CLASS[raw] ?? "UNKNOWN");

export interface AppleDevice {
  readonly id: string;
  readonly udid: string;
  readonly name: string;
  readonly deviceClass: string;
}

export const toAppleDevice = (device: AppleUtils.Device): AppleDevice => ({
  id: device.id,
  udid: device.attributes.udid,
  name: device.attributes.name,
  deviceClass: device.attributes.deviceClass,
});

const EMPTY_SUMMARY = { created: 0, linked: 0, unchanged: 0 } as const;

/**
 * Pull-reconcile an ASC device snapshot into the backend roster for one team.
 * Entries our schema would reject (exotic UDID formats, empty names) are
 * dropped — they can never enter the backend roster, so they must not count
 * toward the profile fingerprint either.
 */
export const reconcilePortalSnapshot = (
  api: ApiClient,
  appleTeamId: string,
  devices: readonly AppleDevice[],
) => {
  const entries = devices
    .filter((device) => APPLE_UDID_PATTERN.test(device.udid) && device.name.length > 0)
    .map((device) => ({
      identifier: device.udid,
      name: device.name.slice(0, 120),
      deviceClass: toDeviceClass(device.deviceClass),
      appleDevicePortalId: device.id,
    }));
  return entries.length > 0
    ? api.devices.syncDevices({ payload: { appleTeamId, devices: entries } })
    : Effect.succeed(EMPTY_SUMMARY);
};

export interface TeamRosterDevice {
  readonly id: string;
  readonly identifier: string;
  readonly name: string;
}

const LIST_LIMIT = 100;

/**
 * The desired device roster for one Apple team: every *enabled* backend device
 * registered under it. Matches the server's `collectDeviceRosterUdids`, which
 * fingerprints this same set for the profile staleness check.
 */
export const listTeamRosterDevices = (api: ApiClient, appleTeamId: string) =>
  Effect.gen(function* () {
    const items: TeamRosterDevice[] = [];
    let page = 1;
    let fetched = 0;
    let total = Number.POSITIVE_INFINITY;
    while (fetched < total) {
      const result = yield* api.devices.list({
        urlParams: { page, limit: LIST_LIMIT, appleTeamId: [appleTeamId] },
      });
      ({ total } = result);
      if (result.items.length === 0) {
        break;
      }
      fetched += result.items.length;
      for (const device of result.items) {
        if (device.enabled) {
          items.push({ id: device.id, identifier: device.identifier, name: device.name });
        }
      }
      page += 1;
    }
    return items;
  });

export interface ProfileDeviceSet {
  /** ASC portal record ids to bake into the profile. */
  readonly attachIds: readonly string[];
  /** UDIDs the profile is fingerprinted over — the reconciled backend roster. */
  readonly rosterUdids: readonly string[];
  /** Roster devices with no attachable portal record (registration failed or tvOS-class). */
  readonly unprovisionable: readonly string[];
}

/**
 * Resolve the device set for an AD_HOC/DEVELOPMENT profile, EAS-style:
 *
 * 1. Pull-reconcile Apple's device snapshot into the backend so the roster the
 *    server fingerprints is the roster the profile is built from.
 * 2. The desired roster = enabled backend devices for the team (optionally
 *    narrowed to explicit backend device ids).
 * 3. Backend-only devices are registered on the portal on demand; failures are
 *    reported, not fatal — Apple may still be processing a device for days.
 *
 * The fingerprint hashes the roster's UDIDs (not portal record ids): Apple can
 * hold several records for one physical device, so record ids would drift from
 * the deduped backend roster on every compare and re-trigger regeneration.
 */
export const collectProfileDeviceSet = (
  api: ApiClient,
  ctx: AppleUtils.RequestContext,
  params: {
    readonly appleTeamId: string;
    readonly deviceIds: readonly string[] | undefined;
  },
) =>
  Effect.gen(function* () {
    const snapshot = (yield* wrapConnect("apple-list-devices", async () =>
      AppleUtils.Device.getAsync(ctx),
    )).map(toAppleDevice);
    yield* reconcilePortalSnapshot(api, params.appleTeamId, snapshot);

    const roster = yield* listTeamRosterDevices(api, params.appleTeamId);
    const desired =
      params.deviceIds === undefined
        ? roster
        : roster.filter((device) => params.deviceIds?.includes(device.id));

    const byUdid = new Map<string, AppleDevice[]>();
    for (const record of snapshot) {
      const key = record.udid.trim().toLowerCase();
      byUdid.set(key, [...(byUdid.get(key) ?? []), record]);
    }

    const attachIds: string[] = [];
    const unprovisionable: string[] = [];
    for (const device of desired) {
      let records = byUdid.get(device.identifier.trim().toLowerCase()) ?? [];
      if (records.length === 0) {
        const created = yield* Effect.either(
          wrapConnect("apple-create-device", async () =>
            AppleUtils.Device.createAsync(ctx, {
              name: device.name,
              udid: device.identifier,
              platform: AppleUtils.BundleIdPlatform.IOS,
            }),
          ),
        );
        records = Either.isRight(created) ? [toAppleDevice(created.right)] : [];
      }
      // tvOS devices cannot join iOS profile types; skip rather than fail.
      const attachable = records.filter((record) => record.deviceClass !== "APPLE_TV");
      if (attachable.length === 0) {
        unprovisionable.push(device.identifier);
      } else {
        attachIds.push(...attachable.map((record) => record.id));
      }
    }

    return {
      attachIds,
      rosterUdids: desired.map((device) => device.identifier),
      unprovisionable,
    } satisfies ProfileDeviceSet;
  });
