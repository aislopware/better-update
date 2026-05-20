import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { idParam } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";
import {
  CreateIosBundleConfigurationBody,
  DeleteIosBundleConfigurationResult,
  IosBundleConfiguration,
  UpdateIosBundleConfigurationBody,
} from "../domain/ios-bundle-configuration";

const projectIdParam = HttpApiSchema.param("projectId", Schema.String);

export class IosBundleConfigurationsGroup extends HttpApiGroup.make("iosBundleConfigurations")
  .add(
    HttpApiEndpoint.get("list")`/api/projects/${projectIdParam}/ios-bundle-configurations`
      .addSuccess(Schema.Struct({ items: Schema.Array(IosBundleConfiguration) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List iOS bundle configurations",
          description: "List all iOS bundle configurations for a project",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("create")`/api/projects/${projectIdParam}/ios-bundle-configurations`
      .setPayload(CreateIosBundleConfigurationBody)
      .addSuccess(IosBundleConfiguration, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Create iOS bundle configuration",
          description: "Bind certificate + profile + push + ASC to a bundle identifier",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("update")`/api/ios-bundle-configurations/${idParam}`
      .setPayload(UpdateIosBundleConfigurationBody)
      .addSuccess(IosBundleConfiguration)
      .annotateContext(
        OpenApi.annotations({
          title: "Update iOS bundle configuration",
          description: "Change the credentials bound to an iOS bundle configuration",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/ios-bundle-configurations/${idParam}`
      .addSuccess(DeleteIosBundleConfigurationResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete iOS bundle configuration",
          description: "Remove an iOS bundle configuration binding",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "iOS Bundle Configurations",
      description: "Per-project per-bundle credential bindings",
    }),
  ) {}
