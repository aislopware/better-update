import { Effect } from "effect";

import { normalizeIdentifier } from "../domain/device";
import { DeviceRepo } from "../repositories/devices";

import type { Conflict } from "../errors";
import type { DeviceClass } from "../models";

export interface SyncDeviceEntry {
  readonly identifier: string;
  readonly name: string;
  readonly deviceClass: DeviceClass;
  readonly appleDevicePortalId: string;
}

export interface SyncDevicesSummary {
  readonly created: number;
  readonly linked: number;
  readonly unchanged: number;
}

/**
 * Reconcile one Apple team's local device roster against an App Store Connect
 * snapshot (already fetched + pushed by the CLI, which owns all Apple I/O). The
 * snapshot is keyed by UDID:
 *
 * - a UDID with no local row is imported (`created`),
 * - a local row whose Apple portal id differs is linked/updated (`linked`),
 * - a local row already carrying that portal id is left alone (`unchanged`).
 *
 * Identifiers are normalised the same way `register` stores them, so the
 * in-memory match mirrors the `(org, team, identifier)` unique index exactly —
 * one read up front, then only the necessary writes.
 */
export const syncAppleDevices = (params: {
  readonly organizationId: string;
  readonly appleTeamId: string;
  readonly devices: readonly SyncDeviceEntry[];
}): Effect.Effect<SyncDevicesSummary, Conflict, DeviceRepo> =>
  Effect.gen(function* () {
    const repo = yield* DeviceRepo;
    const now = new Date().toISOString();

    const existing = yield* repo.findAllByOrg({
      organizationId: params.organizationId,
      appleTeamId: params.appleTeamId,
    });
    const byIdentifier = new Map(existing.map((device) => [device.identifier, device]));

    const zero: SyncDevicesSummary = { created: 0, linked: 0, unchanged: 0 };

    return yield* Effect.reduce(params.devices, zero, (summary, incoming) =>
      Effect.gen(function* () {
        const identifier = normalizeIdentifier(incoming.identifier);
        const local = byIdentifier.get(identifier);

        if (local === undefined) {
          yield* repo.insert({
            id: crypto.randomUUID(),
            organizationId: params.organizationId,
            appleTeamId: params.appleTeamId,
            identifier,
            name: incoming.name,
            model: null,
            deviceClass: incoming.deviceClass,
            enabled: true,
            appleDevicePortalId: incoming.appleDevicePortalId,
            createdAt: now,
            updatedAt: now,
          });
          return { ...summary, created: summary.created + 1 };
        }

        if (local.appleDevicePortalId === incoming.appleDevicePortalId) {
          return { ...summary, unchanged: summary.unchanged + 1 };
        }

        yield* repo.setApplePortalId({
          id: local.id,
          appleDevicePortalId: incoming.appleDevicePortalId,
          updatedAt: now,
        });
        return { ...summary, linked: summary.linked + 1 };
      }),
    );
  });
