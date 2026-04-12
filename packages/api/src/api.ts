import { HttpApi, OpenApi } from "@effect/platform";

import { Authentication } from "./auth/middleware";
import { AnalyticsGroup } from "./groups/analytics";
import { AssetsGroup } from "./groups/assets";
import { BranchesGroup } from "./groups/branches";
import { BuildsGroup } from "./groups/builds";
import { ChannelsGroup } from "./groups/channels";
import { CredentialsGroup } from "./groups/credentials";
import { EnvVarsGroup } from "./groups/env-vars";
import { ProjectsGroup } from "./groups/projects";
import { UpdatesGroup } from "./groups/updates";

export class ManagementApi extends HttpApi.make("management-api")
  .add(ProjectsGroup)
  .add(BranchesGroup)
  .add(ChannelsGroup)
  .add(UpdatesGroup)
  .add(AssetsGroup)
  .add(AnalyticsGroup)
  .add(BuildsGroup)
  .add(CredentialsGroup)
  .add(EnvVarsGroup)
  .middleware(Authentication)
  .annotateContext(
    OpenApi.annotations({
      title: "Better Update Management API",
      version: "1.0.0",
      description: "Management API for OTA update publishing, deployment, and analytics",
    }),
  ) {}
