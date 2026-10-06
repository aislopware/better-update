import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { idParam, pageResult } from "../domain/common";
import {
  CreateDesktopReleaseBody,
  DeleteDesktopReleaseResult,
  DesktopRelease,
  ListDesktopReleasesParams,
  UpdateDesktopReleaseBody,
} from "../domain/desktop-release";
import { BadRequest, Conflict } from "../domain/errors";

const projectIdParam = { projectId: Schema.String };

export const DesktopReleasesGroup = HttpApiGroup.make("desktopReleases")
  .add(
    HttpApiEndpoint.get("list", "/api/projects/:projectId/desktop-releases", {
      params: { ...projectIdParam },
      query: ListDesktopReleasesParams,
      success: pageResult(DesktopRelease),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List desktop releases",
        description: "Releases published to the project's macOS update feeds, newest first",
      }),
    ),
    HttpApiEndpoint.post("create", "/api/projects/:projectId/desktop-releases", {
      params: { ...projectIdParam },
      payload: CreateDesktopReleaseBody,
      success: DesktopRelease.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Release a build",
        description: "Publish a macOS Developer ID build to an update-feed channel",
      }),
    ),
    HttpApiEndpoint.get("get", "/api/desktop-releases/:id", {
      params: { ...idParam },
      success: DesktopRelease,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(OpenApi.annotations({ title: "Get desktop release" })),
    HttpApiEndpoint.patch("update", "/api/desktop-releases/:id", {
      params: { ...idParam },
      payload: UpdateDesktopReleaseBody,
      success: DesktopRelease,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Update desktop release",
        description: "Halt or resume a release, change its rollout, notes or criticality",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/desktop-releases/:id", {
      params: { ...idParam },
      success: DeleteDesktopReleaseResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(OpenApi.annotations({ title: "Delete desktop release" })),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Desktop releases",
      description:
        "macOS builds published to Sparkle / electron-updater feeds, with channels and staged rollout",
    }),
  );
