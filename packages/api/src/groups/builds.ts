import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

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
import { Id, idParam, pageResult } from "../domain/common";
import {
  BuildDebugArtifact,
  CompleteDebugArtifactBody,
  DebugArtifactType,
  DebugDownloadResult,
  DebugUploadReservation,
  ListDebugArtifactsResult,
  ReserveDebugArtifactBody,
} from "../domain/debug-artifact";
import { BadRequest, Conflict } from "../domain/errors";

const debugTypeParam = { type: DebugArtifactType };

export const BuildsGroup = HttpApiGroup.make("builds")
  .add(
    HttpApiEndpoint.post("reserve", "/api/builds", {
      payload: CreateBuildBody,
      success: ReserveBuildResult.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Forbidden, BadRequest],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Reserve build",
        description: "Reserve a build ID and get a presigned upload URL",
      }),
    ),
    HttpApiEndpoint.post("complete", "/api/builds/:id/complete", {
      params: { ...idParam },
      payload: CompleteBuildBody,
      success: BuildWithArtifact,
      error: [Conflict, NotFound, Forbidden, BadRequest],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Complete build",
        description: "Finalize a build after artifact upload",
      }),
    ),
    HttpApiEndpoint.get("list", "/api/builds", {
      query: ListBuildsParams,
      success: pageResult(BuildWithArtifact),
      error: [NotFound, Forbidden, BadRequest],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List builds",
        description: "List builds for a project with optional filters",
      }),
    ),
    HttpApiEndpoint.get("compatibilityMatrix", "/api/builds/compatibility-matrix", {
      query: Schema.Struct({
        projectId: Id,
      }),
      success: BuildCompatibilityMatrixResult,
      error: [NotFound, Forbidden, BadRequest],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Build compatibility matrix",
        description: "List build-to-channel OTA compatibility for a project",
      }),
    ),
    HttpApiEndpoint.get("get", "/api/builds/:id", {
      params: { ...idParam },
      success: BuildWithArtifact,
      error: [NotFound, Forbidden, BadRequest],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Get build",
        description: "Get a build by ID with artifact details",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/builds/:id", {
      params: { ...idParam },
      success: DeleteBuildResult,
      error: [NotFound, Forbidden, BadRequest],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete build",
        description: "Delete a build and its artifact from storage",
      }),
    ),
    HttpApiEndpoint.get("getInstallLink", "/api/builds/:id/install-link", {
      params: { ...idParam },
      success: InstallLinkResult,
      error: [NotFound, Forbidden, BadRequest],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Get install link",
        description: "Generate a signed install link for a build artifact",
      }),
    ),
    HttpApiEndpoint.post("reserveDebugArtifact", "/api/builds/:id/debug-artifacts", {
      params: { ...idParam },
      payload: ReserveDebugArtifactBody,
      success: DebugUploadReservation.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Forbidden, BadRequest],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Reserve debug artifact",
        description:
          "Get a presigned upload URL for a crash-symbolication artifact (dSYM, sourcemap, mapping) of a build",
      }),
    ),
    HttpApiEndpoint.post("completeDebugArtifact", "/api/builds/:id/debug-artifacts/complete", {
      params: { ...idParam },
      payload: CompleteDebugArtifactBody,
      success: BuildDebugArtifact,
      error: [NotFound, Forbidden, BadRequest],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Complete debug artifact",
        description: "Finalize a debug artifact after upload",
      }),
    ),
    HttpApiEndpoint.get("listDebugArtifacts", "/api/builds/:id/debug-artifacts", {
      params: { ...idParam },
      success: ListDebugArtifactsResult,
      error: [NotFound, Forbidden, BadRequest],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List debug artifacts",
        description: "List the crash-symbolication artifacts stored for a build",
      }),
    ),
    HttpApiEndpoint.get(
      "getDebugArtifactDownload",
      "/api/builds/:id/debug-artifacts/:type/download",
      {
        params: { ...idParam, ...debugTypeParam },
        success: DebugDownloadResult,
        error: [NotFound, Forbidden, BadRequest],
      },
    ).annotateMerge(
      OpenApi.annotations({
        title: "Download debug artifact",
        description: "Get a short-lived presigned download URL for a debug artifact",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Builds",
      description: "Build artifact upload, tracking, and download endpoints",
    }),
  );
