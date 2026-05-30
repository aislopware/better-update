import { it } from "@effect/vitest";
import { Effect } from "effect";

import { Conflict, NotFound } from "../errors";
import { ChannelRepo, ProjectRepo, UpdateRepo } from "../repositories";
import { publishUpdate } from "./publish-coordination";

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

interface Spy {
  insertCalls: { isEmbedded: boolean | undefined; id: string | undefined }[];
  clearCalls: number;
  deleteByIdCalls: string[];
  findByIdCalls: string[];
  // The row findById should return for a pinned-id pre-check; null = NotFound.
  existingById: UpdateModel | null;
  // When true, insert() rejects with the typed Conflict the repo raises on a
  // PRIMARY KEY collision.
  insertConflict: boolean;
}

const makeSpy = (overrides?: Partial<Spy>): Spy => ({
  insertCalls: [],
  clearCalls: 0,
  deleteByIdCalls: [],
  findByIdCalls: [],
  existingById: null,
  insertConflict: false,
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
    insertBatch: () => Effect.succeed([]),
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

const operation = (params: { readonly isEmbedded: boolean; readonly id?: string }) => ({
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
  manifestBody: null,
  directiveBody: null,
  fingerprintHash: null,
  gitCommit: null,
  gitDirty: false,
  isEmbedded: params.isEmbedded,
  ...(params.id === undefined ? {} : { id: params.id }),
  assets: [],
  conflictMessage: "conflict",
});

const run = (spy: Spy, params: { readonly isEmbedded: boolean; readonly id?: string }) => {
  const { updateRepo, channelRepo, projectRepo } = makeRepos(spy);
  return publishUpdate(operation(params)).pipe(
    Effect.provideService(UpdateRepo, updateRepo),
    Effect.provideService(ChannelRepo, channelRepo),
    Effect.provideService(ProjectRepo, projectRepo),
  );
};

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
