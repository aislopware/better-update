import { it } from "@effect/vitest";
import { Effect } from "effect";

import { Conflict, NotFound } from "../errors";
import { ChannelRepo, ProjectRepo, UpdateRepo } from "../repositories";
import { publishUpdate, republishUpdate } from "./publish-coordination";

import type { RepublishSourceUpdate } from "../durable-objects/publish-types";
import type { UpdateModel } from "../models";

const baseUpdate: UpdateModel = {
  id: "update-1",
  branchId: "branch-1",
  runtimeVersion: "1.0.0",
  platform: "ios",
  message: "hello",
  metadataJson: "{}",
  extraJson: null,
  groupId: "group-1",
  rolloutPercentage: 100,
  isRollback: false,
  signature: null,
  certificateChain: null,
  manifestBody: null,
  directiveBody: null,
  fingerprintHash: null,
  gitCommit: null,
  gitDirty: false,
  totalAssetSize: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
};

// The single newest served row the clock-skew guard reads (findLatestServedRow).
interface LatestRow {
  manifestBody: string | null;
  directiveBody: string | null;
  createdAt: string;
}

interface Spy {
  insertCalls: { isEmbedded: boolean | undefined; id: string | undefined }[];
  insertBatchCalls: number;
  clearCalls: number;
  deleteByIdCalls: string[];
  findByIdCalls: string[];
  // The row findById should return for a pinned-id pre-check; null = NotFound.
  existingById: UpdateModel | null;
  // When true, insert() rejects with the typed Conflict the repo raises on a
  // PRIMARY KEY collision.
  insertConflict: boolean;
  // The row findLatestServedRow returns for the clock-skew guard; null = empty
  // tuple (first publish), the default.
  latest: LatestRow | null;
}

const makeSpy = (overrides?: Partial<Spy>): Spy => ({
  insertCalls: [],
  insertBatchCalls: 0,
  clearCalls: 0,
  deleteByIdCalls: [],
  findByIdCalls: [],
  existingById: null,
  insertConflict: false,
  latest: null,
  ...overrides,
});

const makeRepos = (spy: Spy) => {
  const updateRepo = UpdateRepo.of({
    insert: (params) => {
      spy.insertCalls.push({ isEmbedded: params.isEmbedded, id: params.id });
      return spy.insertConflict
        ? Effect.fail(new Conflict({ message: `An update with id "${params.id}" already exists` }))
        : Effect.succeed({
            ...baseUpdate,
            ...(params.id === undefined ? {} : { id: params.id }),
          });
    },
    clearEmbeddedBaseline: () => {
      spy.clearCalls += 1;
      return Effect.void;
    },
    deleteById: (params) => {
      spy.deleteByIdCalls.push(params.id);
      return Effect.void;
    },
    insertBatch: (params) => {
      spy.insertBatchCalls += 1;
      return Effect.succeed(
        params.updates.map((update, index) => ({
          ...baseUpdate,
          id: `republished-${index}`,
          branchId: params.branchId,
          platform: update.platform,
          runtimeVersion: update.runtimeVersion,
          manifestBody: update.manifestBody,
          directiveBody: update.directiveBody,
        })),
      );
    },
    listByProjectAndFingerprint: () => Effect.succeed([]),
    findByProject: () => Effect.succeed({ items: [], total: 0 }),
    findById: (params) => {
      spy.findByIdCalls.push(params.id);
      return spy.existingById === null
        ? Effect.fail(new NotFound({ message: "Update not found" }))
        : Effect.succeed(spy.existingById);
    },
    findByGroupId: () => Effect.succeed([]),
    findAssetsByUpdateId: () => Effect.succeed([]),
    findLaunchAssetHashByUpdateId: () => Effect.succeed(null),
    findLatestLaunchAssetHash: () => Effect.succeed(null),
    findLatestServedRow: () => Effect.succeed(spy.latest),
    listPatchBases: () => Effect.succeed([]),
    deleteGroup: () => Effect.succeed({ deleted: 0 }),
    findReapableUpdateBatch: () => Effect.succeed([]),
    findAssetHashesForUpdates: () => Effect.succeed([]),
    findUnreferencedAssetHashes: () => Effect.succeed([]),
    findAssetR2KeysByHashes: () => Effect.succeed([]),
    deleteUpdateRows: () => Effect.succeed({ updatesDeleted: 0 }),
    deleteAssetRows: () => Effect.void,
    findSurvivingUpdateIdsByProject: () => Effect.succeed([]),
    findServableUpdateIdsForBranches: () => Effect.succeed([]),
    findPatchBaseUpdateIdsByProject: () => Effect.succeed([]),
    updateRollout: () => Effect.void,
    hasActiveRollout: () => Effect.succeed(false),
  });

  const channelRepo = ChannelRepo.of({
    bumpCacheVersionByBranch: () => Effect.void,
  } as never);

  const projectRepo = ProjectRepo.of({
    bumpLastActivityByBranch: () => Effect.void,
  } as never);

  return { updateRepo, channelRepo, projectRepo };
};

interface PublishParams {
  readonly isEmbedded: boolean;
  readonly id?: string;
  readonly manifestBody?: string | null;
  readonly directiveBody?: string | null;
}

const operation = (params: PublishParams) => ({
  branchId: "branch-1",
  runtimeVersion: "1.0.0",
  platform: "ios" as const,
  message: "hello",
  metadataJson: "{}",
  extraJson: null,
  groupId: "group-1",
  rolloutPercentage: 100,
  isRollback: false,
  signature: null,
  certificateChain: null,
  manifestBody: params.manifestBody ?? null,
  directiveBody: params.directiveBody ?? null,
  fingerprintHash: null,
  gitCommit: null,
  gitDirty: false,
  isEmbedded: params.isEmbedded,
  ...(params.id === undefined ? {} : { id: params.id }),
  assets: [],
  conflictMessage: "conflict",
});

const run = (spy: Spy, params: PublishParams) => {
  const { updateRepo, channelRepo, projectRepo } = makeRepos(spy);
  return publishUpdate(operation(params)).pipe(
    Effect.provideService(UpdateRepo, updateRepo),
    Effect.provideService(ChannelRepo, channelRepo),
    Effect.provideService(ProjectRepo, projectRepo),
  );
};

const republishSource = (override: Partial<RepublishSourceUpdate>): RepublishSourceUpdate => ({
  runtimeVersion: "1.0.0",
  platform: "ios",
  message: "m",
  metadataJson: "{}",
  extraJson: null,
  signature: null,
  certificateChain: null,
  manifestBody: null,
  directiveBody: null,
  fingerprintHash: null,
  assets: [],
  ...override,
});

const runRepublish = (spy: Spy, update: Partial<RepublishSourceUpdate>) => {
  const { updateRepo, channelRepo, projectRepo } = makeRepos(spy);
  return republishUpdate({
    branchId: "branch-1",
    message: null,
    updates: [republishSource(update)],
    conflictMessage: "rollout in progress",
  }).pipe(
    Effect.provideService(UpdateRepo, updateRepo),
    Effect.provideService(ChannelRepo, channelRepo),
    Effect.provideService(ProjectRepo, projectRepo),
  );
};

// A signed manifest body carrying a specific createdAt (commitTime).
const signedManifest = (createdAt: string) => JSON.stringify({ id: "u", createdAt });

// A rollback directive body carrying a specific parameters.commitTime.
const directive = (commitTime: string) =>
  JSON.stringify({ type: "rollBackToEmbedded", parameters: { commitTime } });

const signedLatest = (createdAt: string): LatestRow => ({
  manifestBody: signedManifest(createdAt),
  directiveBody: null,
  createdAt: "ignored",
});

describe("publishUpdate -- embedded baseline", () => {
  it.effect("clears the prior baseline and inserts with is_embedded when isEmbedded=true", () =>
    Effect.gen(function* () {
      const spy = makeSpy();
      const result = yield* run(spy, {
        isEmbedded: true,
        id: "11111111-1111-1111-1111-111111111111",
      });
      expect(result.ok).toBe(true);
      expect(spy.clearCalls).toBe(1);
      expect(spy.insertCalls).toStrictEqual([
        { isEmbedded: true, id: "11111111-1111-1111-1111-111111111111" },
      ]);
    }),
  );

  it.effect("does not clear the baseline and inserts is_embedded=false otherwise", () =>
    Effect.gen(function* () {
      const spy = makeSpy();
      const result = yield* run(spy, { isEmbedded: false });
      expect(result.ok).toBe(true);
      expect(spy.clearCalls).toBe(0);
      expect(spy.insertCalls).toStrictEqual([{ isEmbedded: false, id: undefined }]);
    }),
  );

  it.effect(
    "re-registers the SAME embedded id for the SAME tuple idempotently (delete then insert, no conflict)",
    () =>
      Effect.gen(function* () {
        const pinnedId = "22222222-2222-2222-2222-222222222222";
        // An existing embedded row under the same (branch, rtv, platform).
        const spy = makeSpy({
          existingById: {
            ...baseUpdate,
            id: pinnedId,
            branchId: "branch-1",
            runtimeVersion: "1.0.0",
            platform: "ios",
          },
        });
        const result = yield* run(spy, { isEmbedded: true, id: pinnedId });

        expect(result.ok).toBe(true);
        // Same-tuple collision is resolved by deleting the prior row first.
        expect(spy.deleteByIdCalls).toStrictEqual([pinnedId]);
        expect(spy.clearCalls).toBe(1);
        expect(spy.insertCalls).toStrictEqual([{ isEmbedded: true, id: pinnedId }]);
      }),
  );

  it.effect(
    "rejects an embedded id already bound to a DIFFERENT tuple with a Conflict (no override)",
    () =>
      Effect.gen(function* () {
        const pinnedId = "33333333-3333-3333-3333-333333333333";
        // The id already exists under a DIFFERENT branch (e.g. another project).
        const spy = makeSpy({
          existingById: {
            ...baseUpdate,
            id: pinnedId,
            branchId: "branch-OTHER",
            runtimeVersion: "1.0.0",
            platform: "ios",
          },
        });
        const result = yield* run(spy, { isEmbedded: true, id: pinnedId });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.message).toContain("already in use");
        }
        // No override + no insert attempted for the colliding id.
        expect(spy.deleteByIdCalls).toStrictEqual([]);
        expect(spy.clearCalls).toBe(0);
        expect(spy.insertCalls).toStrictEqual([]);
      }),
  );

  it.effect("maps a non-embedded pinned-id PK collision (insert Conflict) to a clean failure", () =>
    Effect.gen(function* () {
      const pinnedId = "44444444-4444-4444-4444-444444444444";
      const spy = makeSpy({ insertConflict: true });
      const result = yield* run(spy, { isEmbedded: false, id: pinnedId });

      // The non-embedded path does NOT pre-check; the repo raises a typed
      // Conflict on the PK collision, which publishUpdate converts to a clean
      // failure (→ 409) instead of a defect (→ 500).
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("already exists");
      }
      expect(spy.insertCalls).toStrictEqual([{ isEmbedded: false, id: pinnedId }]);
    }),
  );
});

describe("publishUpdate -- clock-skew guard (precomputed path)", () => {
  it.effect("rejects a signed publish whose manifest createdAt is OLDER than the live update", () =>
    Effect.gen(function* () {
      const spy = makeSpy({ latest: signedLatest("2026-05-10T00:00:00.000Z") });
      const result = yield* run(spy, {
        isEmbedded: false,
        manifestBody: signedManifest("2026-05-01T00:00:00.000Z"),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("Clock skew");
      }
      // The stale signed update must NOT be inserted.
      expect(spy.insertCalls).toStrictEqual([]);
    }),
  );

  it.effect("rejects a signed publish whose manifest createdAt EQUALS the live update", () =>
    Effect.gen(function* () {
      const spy = makeSpy({ latest: signedLatest("2026-05-10T00:00:00.000Z") });
      const result = yield* run(spy, {
        isEmbedded: false,
        manifestBody: signedManifest("2026-05-10T00:00:00.000Z"),
      });
      expect(result.ok).toBe(false);
      expect(spy.insertCalls).toStrictEqual([]);
    }),
  );

  it.effect("allows a signed publish whose manifest createdAt is NEWER than the live update", () =>
    Effect.gen(function* () {
      const spy = makeSpy({ latest: signedLatest("2026-05-10T00:00:00.000Z") });
      const result = yield* run(spy, {
        isEmbedded: false,
        manifestBody: signedManifest("2026-05-11T00:00:00.000Z"),
      });
      expect(result.ok).toBe(true);
      expect(spy.insertCalls).toStrictEqual([{ isEmbedded: false, id: undefined }]);
    }),
  );

  it.effect("rejects a rollback directive whose commitTime is OLDER than the live update", () =>
    Effect.gen(function* () {
      const spy = makeSpy({ latest: signedLatest("2026-05-10T00:00:00.000Z") });
      // A directive is served verbatim too; the device orders it by its
      // parameters.commitTime, so the guard applies to the directive path.
      const result = yield* run(spy, {
        isEmbedded: false,
        directiveBody: directive("2026-05-01T00:00:00.000Z"),
      });
      expect(result.ok).toBe(false);
      expect(spy.insertCalls).toStrictEqual([]);
    }),
  );

  it.effect("rejects a signed publish that loses to a live ROLLBACK directive", () =>
    Effect.gen(function* () {
      // The newest served row is a directive (commitTime 05-10); a signed update
      // dated 05-01 would never be selected over it on-device.
      const spy = makeSpy({
        latest: {
          manifestBody: null,
          directiveBody: directive("2026-05-10T00:00:00.000Z"),
          createdAt: "ignored",
        },
      });
      const result = yield* run(spy, {
        isEmbedded: false,
        manifestBody: signedManifest("2026-05-01T00:00:00.000Z"),
      });
      expect(result.ok).toBe(false);
      expect(spy.insertCalls).toStrictEqual([]);
    }),
  );

  it.effect("allows the first signed publish for a tuple (no live update)", () =>
    Effect.gen(function* () {
      const spy = makeSpy({ latest: null });
      const result = yield* run(spy, {
        isEmbedded: false,
        manifestBody: signedManifest("2026-05-01T00:00:00.000Z"),
      });
      expect(result.ok).toBe(true);
    }),
  );

  it.effect(
    "compares against an UNSIGNED live update's DB created_at (servedCreatedAt) and rejects an older signed publish",
    () =>
      Effect.gen(function* () {
        // Latest is unsigned: its served commitTime is the DB created_at.
        const spy = makeSpy({
          latest: {
            manifestBody: null,
            directiveBody: null,
            createdAt: "2026-05-10T00:00:00.000Z",
          },
        });
        const result = yield* run(spy, {
          isEmbedded: false,
          manifestBody: signedManifest("2026-05-09T00:00:00.000Z"),
        });
        expect(result.ok).toBe(false);
        expect(spy.insertCalls).toStrictEqual([]);
      }),
  );

  it.effect("exempts an UNSIGNED publish from the guard (no manifest/directive body)", () =>
    Effect.gen(function* () {
      const spy = makeSpy({ latest: signedLatest("2026-05-10T00:00:00.000Z") });
      // Unsigned publish renders createdAt from the monotonic DB clock, so the
      // guard does not apply even though `latest` is newer.
      const result = yield* run(spy, { isEmbedded: false, manifestBody: null });
      expect(result.ok).toBe(true);
      expect(spy.insertCalls).toStrictEqual([{ isEmbedded: false, id: undefined }]);
    }),
  );

  it.effect("exempts an embedded-baseline publish from the guard", () =>
    Effect.gen(function* () {
      const spy = makeSpy({ latest: signedLatest("2026-05-10T00:00:00.000Z") });
      const result = yield* run(spy, {
        isEmbedded: true,
        id: "55555555-5555-5555-5555-555555555555",
        manifestBody: signedManifest("2026-05-01T00:00:00.000Z"),
      });
      expect(result.ok).toBe(true);
    }),
  );
});

describe("republishUpdate -- clock-skew guard", () => {
  it.effect(
    "rejects a signed republish not strictly newer than the destination's live update",
    () =>
      Effect.gen(function* () {
        const spy = makeSpy({ latest: signedLatest("2026-05-10T00:00:00.000Z") });
        const result = yield* runRepublish(spy, {
          manifestBody: signedManifest("2026-05-01T00:00:00.000Z"),
          signature: "sig",
          certificateChain: "cert",
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.message).toContain("Clock skew");
        }
        // The promoted update must NOT be inserted.
        expect(spy.insertBatchCalls).toBe(0);
      }),
  );

  it.effect("allows a signed republish strictly newer than the destination's live update", () =>
    Effect.gen(function* () {
      const spy = makeSpy({ latest: signedLatest("2026-05-10T00:00:00.000Z") });
      const result = yield* runRepublish(spy, {
        manifestBody: signedManifest("2026-05-11T00:00:00.000Z"),
        signature: "sig",
        certificateChain: "cert",
      });
      expect(result.ok).toBe(true);
      expect(spy.insertBatchCalls).toBe(1);
    }),
  );

  it.effect("exempts an UNSIGNED republish from the guard (fresh server-clock created_at)", () =>
    Effect.gen(function* () {
      const spy = makeSpy({ latest: signedLatest("2026-05-10T00:00:00.000Z") });
      const result = yield* runRepublish(spy, { manifestBody: null });
      expect(result.ok).toBe(true);
      expect(spy.insertBatchCalls).toBe(1);
    }),
  );
});
