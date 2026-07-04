import { it } from "@effect/vitest";
import { Effect } from "effect";

import { DeviceRepo } from "../repositories/devices";
import { syncAppleDevices } from "./sync-apple-devices";

import type { DeviceModel } from "../models";
import type { DeviceRepository } from "../repositories/devices";
import type { SyncDeviceEntry } from "./sync-apple-devices";

const UDID = "00008020-0011286622f8002e";

const device = (overrides: Partial<DeviceModel>): DeviceModel => ({
  id: "d-1",
  organizationId: "org-1",
  appleTeamId: "team-1",
  identifier: UDID,
  name: "iPhone",
  model: null,
  deviceClass: "IPHONE",
  enabled: true,
  appleDevicePortalId: "PORTAL1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const entry = (overrides: Partial<SyncDeviceEntry>): SyncDeviceEntry => ({
  identifier: UDID,
  name: "iPhone",
  deviceClass: "IPHONE",
  appleDevicePortalId: "PORTAL1",
  ...overrides,
});

interface Spy {
  inserts: string[];
  updates: { id: string; appleTeamId: string | null | undefined }[];
  portalSets: { id: string; appleDevicePortalId: string }[];
}

const makeSpy = (): Spy => ({ inserts: [], updates: [], portalSets: [] });

const makeRepo = (existing: readonly DeviceModel[], spy: Spy) => {
  const repo: Pick<DeviceRepository, "findAllByOrg" | "insert" | "update" | "setApplePortalId"> = {
    findAllByOrg: () => Effect.succeed(existing),
    insert: (params) => {
      spy.inserts.push(params.identifier);
      return Effect.void;
    },
    update: (params) => {
      spy.updates.push({ id: params.id, appleTeamId: params.appleTeamId });
      return Effect.void;
    },
    setApplePortalId: (params) => {
      spy.portalSets.push({ id: params.id, appleDevicePortalId: params.appleDevicePortalId });
      return Effect.void;
    },
  };
  return DeviceRepo.of(repo as DeviceRepository);
};

const run = (existing: readonly DeviceModel[], devices: readonly SyncDeviceEntry[], spy: Spy) =>
  syncAppleDevices({ organizationId: "org-1", appleTeamId: "team-1", devices }).pipe(
    Effect.provideService(DeviceRepo, makeRepo(existing, spy)),
  );

// Apple can list the same UDID under two device records; without dedup the
// second occurrence re-inserts the row the first just created and the unique
// index aborts the whole sync.
it.effect("collapses duplicate Apple UDIDs into a single insert", () =>
  Effect.gen(function* () {
    const spy = makeSpy();
    const summary = yield* run(
      [],
      [entry({ appleDevicePortalId: "A" }), entry({ appleDevicePortalId: "B" })],
      spy,
    );
    expect(spy.inserts).toStrictEqual([UDID]);
    expect(summary).toStrictEqual({ created: 1, linked: 0, unchanged: 0 });
  }),
);

it.effect("adopts a team-less local row into the synced team", () =>
  Effect.gen(function* () {
    const spy = makeSpy();
    const local = device({ id: "null-row", appleTeamId: null, appleDevicePortalId: null });
    const summary = yield* run([local], [entry({ appleDevicePortalId: "P" })], spy);
    expect(spy.updates).toStrictEqual([{ id: "null-row", appleTeamId: "team-1" }]);
    expect(spy.portalSets).toStrictEqual([{ id: "null-row", appleDevicePortalId: "P" }]);
    expect(spy.inserts).toStrictEqual([]);
    expect(summary).toStrictEqual({ created: 0, linked: 1, unchanged: 0 });
  }),
);

it.effect("leaves an already-linked on-team device unchanged", () =>
  Effect.gen(function* () {
    const spy = makeSpy();
    const local = device({ id: "t", appleTeamId: "team-1", appleDevicePortalId: "P" });
    const summary = yield* run([local], [entry({ appleDevicePortalId: "P" })], spy);
    expect(spy.portalSets).toStrictEqual([]);
    expect(spy.updates).toStrictEqual([]);
    expect(summary).toStrictEqual({ created: 0, linked: 0, unchanged: 1 });
  }),
);

it.effect("relinks an on-team device whose Apple portal id changed", () =>
  Effect.gen(function* () {
    const spy = makeSpy();
    const local = device({ id: "t", appleTeamId: "team-1", appleDevicePortalId: "OLD" });
    const summary = yield* run([local], [entry({ appleDevicePortalId: "NEW" })], spy);
    expect(spy.portalSets).toStrictEqual([{ id: "t", appleDevicePortalId: "NEW" }]);
    expect(spy.updates).toStrictEqual([]);
    expect(summary).toStrictEqual({ created: 0, linked: 1, unchanged: 0 });
  }),
);

// A device registered on another Apple team with the same UDID is a distinct
// resource; the target team gets its own fresh row rather than stealing it.
it.effect("registers a fresh row when the UDID belongs to another team", () =>
  Effect.gen(function* () {
    const spy = makeSpy();
    const local = device({ id: "other", appleTeamId: "team-2", appleDevicePortalId: "X" });
    const summary = yield* run([local], [entry({ appleDevicePortalId: "Y" })], spy);
    expect(spy.inserts).toStrictEqual([UDID]);
    expect(spy.updates).toStrictEqual([]);
    expect(spy.portalSets).toStrictEqual([]);
    expect(summary).toStrictEqual({ created: 1, linked: 0, unchanged: 0 });
  }),
);
