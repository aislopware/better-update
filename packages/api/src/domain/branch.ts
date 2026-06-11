import { Schema } from "effect";

import { DateTimeString, DeletedResult, Id, PaginationParams, sortParam } from "./common";

export class Branch extends Schema.Class<Branch>("Branch")({
  id: Id,
  projectId: Id,
  name: Schema.String,
  isBuiltin: Schema.Boolean,
  createdAt: DateTimeString,
  updateCount: Schema.Number,
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
