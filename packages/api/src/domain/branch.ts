import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

export class Branch extends Schema.Class<Branch>("Branch")({
  id: Id,
  projectId: Id,
  name: Schema.String,
  createdAt: DateTimeString,
}) {}

export const CreateBranchBody = Schema.Struct({
  projectId: Id,
  name: Schema.String.pipe(Schema.minLength(1)),
});

export const UpdateBranchBody = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1)),
});

export const DeleteBranchResult = Schema.Struct({ deleted: Schema.Number });
