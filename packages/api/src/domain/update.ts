import { Schema } from "effect";

import { DateTimeString, DeletedResult, Id, PaginationParams, Platform, sortParam } from "./common";

export class Update extends Schema.Class<Update>("Update")({
  id: Id,
  branchId: Id,
  runtimeVersion: Schema.String,
  platform: Platform,
  message: Schema.String,
  metadataJson: Schema.String,
  extraJson: Schema.NullOr(Schema.String),
  groupId: Schema.String,
  rolloutPercentage: Schema.Number,
  isRollback: Schema.Boolean,
  signature: Schema.NullOr(Schema.String),
  certificateChain: Schema.NullOr(Schema.String),
  manifestBody: Schema.NullOr(Schema.String),
  directiveBody: Schema.NullOr(Schema.String),
  fingerprintHash: Schema.NullOr(Schema.String),
  // Git provenance captured at publish time (mirrors EAS gitCommitHash +
  // isGitWorkingTreeDirty, and the Build read schema). `gitCommit` is the
  // resolved HEAD SHA or null on a non-git project / empty repo; `gitDirty`
  // flags an uncommitted working tree (false when clean or unknown).
  gitCommit: Schema.NullOr(Schema.String),
  gitDirty: Schema.Boolean,
  totalAssetSize: Schema.Number,
  createdAt: DateTimeString,
}) {}

export const UpdateSortColumn = Schema.Literal(
  "createdAt",
  "runtimeVersion",
  "platform",
  "rolloutPercentage",
);

export const UpdateSort = sortParam(UpdateSortColumn);

export const ListUpdatesParams = Schema.Struct({
  projectId: Id,
  branchId: Schema.optional(Id),
  platform: Schema.optional(Platform),
  runtimeVersion: Schema.optional(Schema.String),
  // Case-insensitive substring match on the publish message or git commit SHA.
  query: Schema.optional(Schema.String),
  ...PaginationParams.fields,
  sort: Schema.optional(UpdateSort),
});

/**
 * A candidate base update the CLI can diff a new bundle against to produce a
 * bsdiff patch. One row per recent published update (+ the embedded baseline),
 * carrying the launch-asset hash so the CLI can fetch the exact base bytes.
 */
export class PatchBaseCandidate extends Schema.Class<PatchBaseCandidate>("PatchBaseCandidate")({
  updateId: Id,
  launchAssetHash: Schema.String,
  runtimeVersion: Schema.String,
  platform: Platform,
  isEmbedded: Schema.Boolean,
  createdAt: DateTimeString,
}) {}

/**
 * Query params for listing patch-base candidates. Scoped to a single
 * (project, branch|channel, runtimeVersion, platform). `branchId` and `channel`
 * are mutually exclusive resolution inputs; the server resolves `channel` to a
 * branch. `limit` bounds the recent window (defaulted + capped server-side).
 */
export const ListPatchBasesParams = Schema.Struct({
  projectId: Id,
  branchId: Schema.optional(Id),
  channel: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  runtimeVersion: Schema.String.pipe(Schema.minLength(1)),
  platform: Platform,
  limit: Schema.optional(Schema.NumberFromString),
});

export const AssetRef = Schema.Struct({
  hash: Schema.String,
  key: Schema.String,
  isLaunch: Schema.Boolean,
  contentChecksum: Schema.optional(Schema.String),
});

export const UpdateAssetEntry = Schema.Struct({
  hash: Schema.String,
  key: Schema.String,
  isLaunch: Schema.Boolean,
  contentChecksum: Schema.NullOr(Schema.String),
});

export const CreateUpdateBody = Schema.Struct({
  branch: Schema.String.pipe(Schema.minLength(1)),
  slug: Schema.String.pipe(Schema.minLength(1)),
  runtimeVersion: Schema.String.pipe(Schema.minLength(1)),
  platform: Platform,
  message: Schema.String,
  groupId: Schema.String.pipe(Schema.minLength(1)),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  extra: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  assets: Schema.Array(AssetRef),
  // Client-supplied deterministic update id. Two distinct contracts share this
  // one optional field; which one applies is decided by `isEmbedded`:
  //
  //  • render-then-sign (isEmbedded:false): the launchAsset.url + the manifest's
  //    own `id` field must be known BEFORE signing, so the CLI generates the id
  //    and the server persists THAT id (rather than generating one), keeping the
  //    served row id, the manifest id, and the bundle-route id all equal to the
  //    signed value. Permissive shape (any `Id`); omitted on the unsigned path
  //    (server generates).
  //
  //  • embedded baseline (isEmbedded:true): id MUST be the lowercase
  //    `app.manifest` UUID baked into the native binary at build time (the value
  //    the device reports as `expo-embedded-update-id`). It is REQUIRED and
  //    lowercase-UUID-validated server-side (see UuidLower /
  //    domain/embedded-baseline-validation.ts) so first-launch bsdiff patches
  //    keyed by the embedded id resolve against this row.
  //
  // The schema-level shape stays `Schema.optional(Id)` because both contracts
  // coexist on one body; the embedded-only strictness lives in the handler,
  // where `id` and `isEmbedded` are correlated.
  id: Schema.optional(Id),
  manifestBody: Schema.optional(Schema.String),
  directiveBody: Schema.optional(Schema.String),
  isRollback: Schema.optional(Schema.Boolean),
  // The FULL `expo-signature` SFV string (sig/keyid/alg), not bare base64.
  signature: Schema.optional(Schema.String),
  certificateChain: Schema.optional(Schema.String),
  rolloutPercentage: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 100))),
  fingerprintHash: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  // Git provenance captured at publish time (mirrors EAS gitCommitHash +
  // isGitWorkingTreeDirty, and the builds path). Both optional — present only
  // when the project root is a readable git repo. `gitCommit` is the resolved
  // HEAD SHA; `gitDirty` flags an uncommitted working tree. Sent ALWAYS when
  // git is readable (not gated on --auto), matching EAS.
  gitCommit: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  gitDirty: Schema.optional(Schema.Boolean),
  // When true, this update becomes the embedded baseline for
  // (project, runtimeVersion, platform) — the patch base for first-launch
  // bsdiff patches (the client sends its id as `expo-embedded-update-id`).
  // Exactly one embedded baseline exists per (runtime, platform); publishing a
  // new one flips the flag. The embedded bundle's launch asset is uploaded via
  // the normal assets flow — no separate bytes field.
  isEmbedded: Schema.optional(Schema.Boolean),
});

export const RepublishBody = Schema.Struct({
  sourceUpdateId: Schema.optional(Id),
  sourceGroupId: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  destinationBranchId: Schema.optional(Id),
  destinationChannel: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  message: Schema.optional(Schema.String),
  signedUpdates: Schema.optional(
    Schema.Array(
      Schema.Struct({
        sourceUpdateId: Id,
        manifestBody: Schema.String.pipe(Schema.minLength(1)),
        signature: Schema.String.pipe(Schema.minLength(1)),
        certificateChain: Schema.String.pipe(Schema.minLength(1)),
      }),
    ),
  ),
});

export const RepublishResult = Schema.Struct({
  updates: Schema.Array(Update),
});

export const DeleteUpdateResult = DeletedResult;
