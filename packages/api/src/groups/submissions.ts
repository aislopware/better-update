import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { idParam, pageResult, PaginationParams, Platform } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";
import { CreateSubmissionBody, DeleteSubmissionResult, Submission } from "../domain/submission";

const projectIdParam = HttpApiSchema.param("projectId", Schema.String);

const ListParams = Schema.Struct({
  ...PaginationParams.fields,
  platform: Schema.optional(Platform),
  profile: Schema.optional(Schema.String),
  buildId: Schema.optional(Schema.String),
});

export class SubmissionsGroup extends HttpApiGroup.make("submissions")
  .add(
    HttpApiEndpoint.get("list")`/api/projects/${projectIdParam}/submissions`
      .setUrlParams(ListParams)
      .addSuccess(pageResult(Submission))
      .annotateContext(
        OpenApi.annotations({
          title: "List submissions",
          description: "List store submissions for a project with optional filters",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("create")`/api/projects/${projectIdParam}/submissions`
      .setPayload(CreateSubmissionBody)
      .addSuccess(Submission, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Record submission",
          description: "Record a store submission after a successful client-side upload",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("get")`/api/submissions/${idParam}`.addSuccess(Submission).annotateContext(
      OpenApi.annotations({
        title: "Get submission",
        description: "Get a submission by id",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/submissions/${idParam}`
      .addSuccess(DeleteSubmissionResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete submission",
          description: "Delete a submission record",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Submissions",
      description: "Store-submission success history (App Store + Google Play)",
    }),
  ) {}
