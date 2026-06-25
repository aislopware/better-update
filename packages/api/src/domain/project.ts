import { Schema } from "effect";

import {
  DeletedResult,
  PaginationParams,
  DateTimeString,
  Id,
  sortParam,
  UploadHeaders,
} from "./common";

export class Project extends Schema.Class<Project>("Project")({
  id: Id,
  organizationId: Id,
  name: Schema.String,
  slug: Schema.String,
  createdAt: DateTimeString,
  lastActivityAt: DateTimeString,
  /** ISO-8601 timestamp the project was archived (read-only); `null` when active. */
  archivedAt: Schema.NullOr(DateTimeString),
  /** Absolute public CDN URL of the project logo; `null` when none is set. */
  logoUrl: Schema.NullOr(Schema.String),
  branchCount: Schema.Number,
  channelCount: Schema.Number,
  updateCount: Schema.Number,
}) {}

/** Image MIME types accepted for a project logo. */
export const ProjectLogoContentType = Schema.Literal(
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
);

/**
 * Request a presigned PUT to upload a project logo. The server builds the R2 key
 * itself (`logos/{projectId}`) — never trusting a client-sent key — and signs the
 * content type into the URL, so the direct upload must send the returned headers.
 */
export const ProjectLogoUploadBody = Schema.Struct({
  contentType: ProjectLogoContentType,
});

export const ProjectLogoUploadResult = Schema.Struct({
  /** R2 object key the presigned URL targets (`logos/{projectId}`). */
  key: Schema.String,
  uploadUrl: Schema.String,
  uploadExpiresAt: DateTimeString,
  uploadHeaders: UploadHeaders,
});

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
