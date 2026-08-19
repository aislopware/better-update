import { Schema } from "effect";

import { DateTimeString, DeletedResult, Id, PaginationParams, sortParam } from "./common";

export const Branch = Schema.Struct({
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
}).annotate({ identifier: "Branch" });
export type Branch = typeof Branch.Type;

export const BranchSortColumn = Schema.Literals(["name", "createdAt", "updateCount"]);

export const BranchSort = sortParam(BranchSortColumn);

export const ListBranchesParams = Schema.Struct({
  projectId: Id,
  ...PaginationParams.fields,
  query: Schema.optional(Schema.String),
  sort: Schema.optional(BranchSort),
});

export const CreateBranchBody = Schema.Struct({
  projectId: Id,
  name: Schema.String.check(Schema.isMinLength(1)),
});

export const UpdateBranchBody = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
});

export const DeleteBranchResult = DeletedResult;
