import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

export class Project extends Schema.Class<Project>("Project")({
  id: Id,
  organizationId: Id,
  name: Schema.String,
  slug: Schema.String,
  createdAt: DateTimeString,
  lastActivityAt: DateTimeString,
  branchCount: Schema.Number,
  channelCount: Schema.Number,
  updateCount: Schema.Number,
}) {}

export const CreateProjectBody = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1)),
  slug: Schema.String.pipe(Schema.minLength(1)),
});

export const UpdateProjectBody = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1)),
});

export const DeleteProjectResult = Schema.Struct({ deleted: Schema.Number });
