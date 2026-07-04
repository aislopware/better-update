import { Effect } from "effect";

import { normalizeIdentifier } from "../domain/device";
import { DeviceRepo } from "../repositories/devices";

import type { Conflict } from "../errors";
import type { DeviceClass, DeviceModel } from "../models";

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
 * - a team-less local row is adopted into the team and linked (`linked`),
 * - a local row on the team whose portal id differs is linked/updated (`linked`),
 * - a local row already carrying that portal id is left alone (`unchanged`).
 *
 * Two invariants keep this within the `(org, coalesce(team,''), identifier)`
 * unique index, so a stale in-memory view can never trip a constraint mid-sync:
 *
 * 1. **Reconcile against the whole org roster, not just the target team.** A
 *    device may have been registered team-less (or under another team) with the
 *    same UDID; grouping by identifier lets us adopt/link the right row instead
 *    of blindly inserting a duplicate that the unique index rejects.
 * 2. **Collapse duplicate UDIDs in the snapshot.** Apple can list the same UDID
 *    under several device records (a device disabled then re-added keeps its
 *    UDID), so we process one record per normalized identifier — otherwise the
 *    second occurrence would re-insert the row the first just created and abort
 *    the entire sync.
 */
export const syncAppleDevices = (params: {
  readonly organizationId: string;
  readonly appleTeamId: string;
  readonly devices: readonly SyncDeviceEntry[];
}): Effect.Effect<SyncDevicesSummary, Conflict, DeviceRepo> =>
  Effect.gen(function* () {
    const repo = yield* DeviceRepo;
    const now = new Date().toISOString();

    const existing = yield* repo.findAllByOrg({ organizationId: params.organizationId });
    const byIdentifier = existing.reduce((map, device) => {
      const group = map.get(device.identifier);
      return group === undefined
        ? map.set(device.identifier, [device])
        : map.set(device.identifier, [...group, device]);
    }, new Map<string, DeviceModel[]>());

    const seen = new Set<string>();
    const deduped = params.devices.flatMap((device) => {
      const identifier = normalizeIdentifier(device.identifier);
      if (seen.has(identifier)) {
        return [];
      }
      seen.add(identifier);
      return [{ ...device, identifier }];
    });

    const zero: SyncDevicesSummary = { created: 0, linked: 0, unchanged: 0 };

    return yield* Effect.reduce(deduped, zero, (summary, incoming) =>
      Effect.gen(function* () {
        const group = byIdentifier.get(incoming.identifier) ?? [];
        // A row already on the target team wins (link in place); otherwise a
        // team-less row is adopted; a row on *another* team is ignored so we
        // register a fresh one for this team.
        const onTeam = group.find((row) => row.appleTeamId === params.appleTeamId);
        const local = onTeam ?? group.find((row) => row.appleTeamId === null);

        if (local === undefined) {
          yield* repo.insert({
            id: crypto.randomUUID(),
            organizationId: params.organizationId,
            appleTeamId: params.appleTeamId,
            identifier: incoming.identifier,
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

        if (local.appleTeamId === params.appleTeamId) {
          if (local.appleDevicePortalId === incoming.appleDevicePortalId) {
            return { ...summary, unchanged: summary.unchanged + 1 };
          }
          yield* repo.setApplePortalId({
            id: local.id,
            appleDevicePortalId: incoming.appleDevicePortalId,
            updatedAt: now,
          });
          return { ...summary, linked: summary.linked + 1 };
        }

        // Adopt the team-less row into the synced team, then link its portal id,
        // so subsequent syncs find it under the team.
        yield* repo.update({
          id: local.id,
          appleTeamId: params.appleTeamId,
          updatedAt: now,
        });
        yield* repo.setApplePortalId({
          id: local.id,
          appleDevicePortalId: incoming.appleDevicePortalId,
          updatedAt: now,
        });
        return { ...summary, linked: summary.linked + 1 };
      }),
    );
  });
