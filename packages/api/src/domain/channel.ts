import { Schema } from "effect";

import { DateTimeString, DeletedResult, Id, PaginationParams, sortParam } from "./common";

export class Channel extends Schema.Class<Channel>("Channel")({
  id: Id,
  projectId: Id,
  name: Schema.String,
  branchId: Id,
  // Branch names resolved server-side so channel surfaces never need a
  // separate branches fetch to label the linked branch or an active rollout's
  // target. Optional for wire compatibility with older servers; absent = fall
  // back to the raw ids. `rolloutTargetBranchName` is present only while a
  // branch rollout is active (branchMappingJson non-null with a target).
  branchName: Schema.optional(Schema.String),
  rolloutTargetBranchName: Schema.optional(Schema.String),
  branchMappingJson: Schema.NullOr(Schema.String),
  cacheVersion: Schema.Number,
  isPaused: Schema.Boolean,
  isBuiltin: Schema.Boolean,
  createdAt: DateTimeString,
}) {}

export const ChannelSortColumn = Schema.Literal("name", "createdAt");

export const ChannelSort = sortParam(ChannelSortColumn);

export const ListChannelsParams = Schema.Struct({
  projectId: Id,
  ...PaginationParams.fields,
  query: Schema.optional(Schema.String),
  // Restrict to channels whose linked (default) branch is this branch.
  branchId: Schema.optional(Id),
  sort: Schema.optional(ChannelSort),
});

export const CreateChannelBody = Schema.Struct({
  projectId: Id,
  name: Schema.String.pipe(Schema.minLength(1)),
  branchId: Id,
});

export const UpdateChannelBody = Schema.Struct({
  branchId: Id,
});

export const CreateBranchRolloutBody = Schema.Struct({
  newBranchId: Id,
  percentage: Schema.Number.pipe(Schema.int(), Schema.between(1, 100)),
  runtimeVersion: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
});

export const DeleteChannelResult = DeletedResult;
