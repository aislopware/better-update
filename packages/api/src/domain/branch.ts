import { Schema } from "effect";

import { DateTimeString, Id, PaginationParams } from "./common";

export class Branch extends Schema.Class<Branch>("Branch")({
  id: Id,
  projectId: Id,
  name: Schema.String,
  createdAt: DateTimeString,
  updateCount: Schema.Number,
}) {}

export const BranchSortColumn = Schema.Literal("name", "createdAt", "updateCount");

/**
 * Sort param: column name optionally prefixed with `-` for descending.
 * Example: `name` (asc), `-createdAt` (desc).
 */
export const BranchSort = Schema.Union(
  BranchSortColumn,
  Schema.TemplateLiteral("-", BranchSortColumn),
);

export const ListBranchesParams = Schema.Struct({
  projectId: Id,
  ...PaginationParams.fields,
  sort: Schema.optional(BranchSort),
});

export const CreateBranchBody = Schema.Struct({
  projectId: Id,
  name: Schema.String.pipe(Schema.minLength(1)),
});

export const UpdateBranchBody = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1)),
});

export const DeleteBranchResult = Schema.Struct({ deleted: Schema.Number });
