import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { idParam, pageResult, PaginationParams, Platform } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";
import { CreateSubmissionBody, DeleteSubmissionResult, Submission } from "../domain/submission";

const projectIdParam = { projectId: Schema.String };

const ListParams = Schema.Struct({
  ...PaginationParams.fields,
  platform: Schema.optional(Platform),
  profile: Schema.optional(Schema.String),
  buildId: Schema.optional(Schema.String),
});

export const SubmissionsGroup = HttpApiGroup.make("submissions")
  .add(
    HttpApiEndpoint.get("list", "/api/projects/:projectId/submissions", {
      params: { ...projectIdParam },
      query: ListParams,
      success: pageResult(Submission),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List submissions",
        description: "List store submissions for a project with optional filters",
      }),
    ),
    HttpApiEndpoint.post("create", "/api/projects/:projectId/submissions", {
      params: { ...projectIdParam },
      payload: CreateSubmissionBody,
      success: Submission.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Record submission",
        description: "Record a store submission after a successful client-side upload",
      }),
    ),
    HttpApiEndpoint.get("get", "/api/submissions/:id", {
      params: { ...idParam },
      success: Submission,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Get submission",
        description: "Get a submission by id",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/submissions/:id", {
      params: { ...idParam },
      success: DeleteSubmissionResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete submission",
        description: "Delete a submission record",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Submissions",
      description: "Store-submission success history (App Store + Google Play)",
    }),
  );
