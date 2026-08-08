import { Schema } from "effect";

import { DateTimeString, DeletedResult, Id, PaginationParams, sortParam } from "./common";

export class Branch extends Schema.Class<Branch>("Branch")({
  id: Id,
  projectId: Id,
  name: Schema.String,
  isBuiltin: Schema.Boolean,
  createdAt: DateTimeString,
  updateCount: Schema.Number,
  // What a branch is for: the channels that serve it, and when something last
  // landed on it. A branch nobody serves and nobody publishes to is the row a
  // reader is looking for, and neither fact can be derived from the count.
  channelNames: Schema.Array(Schema.String),
  latestUpdateAt: Schema.NullOr(DateTimeString),
}) {}

export const BranchSortColumn = Schema.Literal("name", "createdAt", "updateCount");

export const BranchSort = sortParam(BranchSortColumn);

export const ListBranchesParams = Schema.Struct({
  projectId: Id,
  ...PaginationParams.fields,
  query: Schema.optional(Schema.String),
  sort: Schema.optional(BranchSort),
});

export const CreateBranchBody = Schema.Struct({
  projectId: Id,
  name: Schema.String.pipe(Schema.minLength(1)),
});

export const UpdateBranchBody = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1)),
});

export const DeleteBranchResult = DeletedResult;
