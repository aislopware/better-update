import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

export class Project extends Schema.Class<Project>("Project")({
  id: Id,
  organizationId: Id,
  name: Schema.String,
  scopeKey: Schema.String,
  createdAt: DateTimeString,
}) {}

export const CreateProjectBody = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1)),
  scopeKey: Schema.String.pipe(Schema.minLength(1)),
});

export const DeleteProjectResult = Schema.Struct({ deleted: Schema.Number });
