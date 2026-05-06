import { Schema } from "effect";

import { DateTimeString, Id, PaginationParams } from "./common";

export class Channel extends Schema.Class<Channel>("Channel")({
  id: Id,
  projectId: Id,
  name: Schema.String,
  branchId: Id,
  branchMappingJson: Schema.NullOr(Schema.String),
  cacheVersion: Schema.Number,
  isPaused: Schema.Boolean,
  createdAt: DateTimeString,
}) {}

export const ChannelSortColumn = Schema.Literal("name", "createdAt");

/**
 * Sort param: column name optionally prefixed with `-` for descending.
 * Example: `name` (asc), `-createdAt` (desc).
 */
export const ChannelSort = Schema.Union(
  ChannelSortColumn,
  Schema.TemplateLiteral("-", ChannelSortColumn),
);

export const ListChannelsParams = Schema.Struct({
  projectId: Id,
  ...PaginationParams.fields,
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
});

export const DeleteChannelResult = Schema.Struct({ deleted: Schema.Number });
