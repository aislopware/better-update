import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { idParam, pageResult, PaginationParams, Platform } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";
import {
  CancelSubmissionResult,
  CreateSubmissionBody,
  DeleteSubmissionResult,
  Submission,
  SubmissionStatus,
  UpdateSubmissionStatusBody,
} from "../domain/submission";

const projectIdParam = HttpApiSchema.param("projectId", Schema.String);

const ListParams = Schema.Struct({
  ...PaginationParams.fields,
  status: Schema.optional(SubmissionStatus),
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
          title: "Create submission",
          description: "Start a store submission for a build / IPA / AAB",
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
    HttpApiEndpoint.patch("updateStatus")`/api/submissions/${idParam}/status`
      .setPayload(UpdateSubmissionStatusBody)
      .addSuccess(Submission)
      .annotateContext(
        OpenApi.annotations({
          title: "Update submission status",
          description: "Patch status / error / logFiles. CLI uses this for iOS submissions.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("cancel")`/api/submissions/${idParam}/cancel`
      .addSuccess(CancelSubmissionResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Cancel submission",
          description: "Cancel an AWAITING_BUILD / IN_QUEUE submission",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/submissions/${idParam}`
      .addSuccess(DeleteSubmissionResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete submission",
          description: "Delete a terminal submission record",
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
      description: "Store-submission lifecycle (App Store + Google Play)",
    }),
  ) {}
