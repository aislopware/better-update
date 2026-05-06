import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  BuildWithArtifact,
  CompleteBuildBody,
  CreateBuildBody,
  DeleteBuildResult,
  InstallLinkResult,
  ListBuildsParams,
  ReserveBuildResult,
} from "../domain/build";
import { BuildCompatibilityMatrixResult } from "../domain/build-compatibility";
import { Id } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";

const idParam = HttpApiSchema.param("id", Schema.String);

export class BuildsGroup extends HttpApiGroup.make("builds")
  .add(
    HttpApiEndpoint.post("reserve", "/api/builds")
      .setPayload(CreateBuildBody)
      .addSuccess(ReserveBuildResult, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Reserve build",
          description: "Reserve a build ID and get a presigned upload URL",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("complete")`/api/builds/${idParam}/complete`
      .setPayload(CompleteBuildBody)
      .addSuccess(BuildWithArtifact)
      .addError(Conflict)
      .annotateContext(
        OpenApi.annotations({
          title: "Complete build",
          description: "Finalize a build after artifact upload",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("list", "/api/builds")
      .setUrlParams(ListBuildsParams)
      .addSuccess(
        Schema.Struct({
          items: Schema.Array(BuildWithArtifact),
          total: Schema.Number,
          page: Schema.Number,
          limit: Schema.Number,
        }),
      )
      .annotateContext(
        OpenApi.annotations({
          title: "List builds",
          description: "List builds for a project with optional filters",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("compatibilityMatrix", "/api/builds/compatibility-matrix")
      .setUrlParams(
        Schema.Struct({
          projectId: Id,
        }),
      )
      .addSuccess(BuildCompatibilityMatrixResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Build compatibility matrix",
          description: "List build-to-channel OTA compatibility for a project",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("get")`/api/builds/${idParam}`
      .addSuccess(BuildWithArtifact)
      .annotateContext(
        OpenApi.annotations({
          title: "Get build",
          description: "Get a build by ID with artifact details",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/builds/${idParam}`
      .addSuccess(DeleteBuildResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete build",
          description: "Delete a build and its artifact from storage",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("getInstallLink")`/api/builds/${idParam}/install-link`
      .addSuccess(InstallLinkResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Get install link",
          description: "Generate a signed install link for a build artifact",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Forbidden)
  .addError(BadRequest)
  .annotateContext(
    OpenApi.annotations({
      title: "Builds",
      description: "Build artifact upload, tracking, and download endpoints",
    }),
  ) {}
