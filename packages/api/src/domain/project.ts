import { Schema } from "effect";

import { DeletedResult, PaginationParams, DateTimeString, Id, sortParam } from "./common";

export class Project extends Schema.Class<Project>("Project")({
  id: Id,
  organizationId: Id,
  name: Schema.String,
  slug: Schema.String,
  createdAt: DateTimeString,
  lastActivityAt: DateTimeString,
  /** ISO-8601 timestamp the project was archived (read-only); `null` when active. */
  archivedAt: Schema.NullOr(DateTimeString),
  branchCount: Schema.Number,
  channelCount: Schema.Number,
  updateCount: Schema.Number,
}) {}

export const ProjectSortColumn = Schema.Literal(
  "lastActivityAt",
  "name",
  "createdAt",
  "branchCount",
  "channelCount",
  "updateCount",
);

export const ProjectSort = sortParam(ProjectSortColumn);

export const ListProjectsParams = Schema.Struct({
  ...PaginationParams.fields,
  query: Schema.optional(Schema.String),
  sort: Schema.optional(ProjectSort),
  // Archival filter. Omitted (or "active") lists only active projects; "archived"
  // lists only archived ones; "all" lists both. String literals because url params
  // decode from strings.
  status: Schema.optional(Schema.Literal("active", "archived", "all")),
});

export const CreateProjectBody = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1)),
  slug: Schema.String.pipe(Schema.minLength(1)),
});

export const UpdateProjectBody = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1)),
});

export const DeleteProjectResult = DeletedResult;
