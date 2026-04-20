import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  AppleProvisioningProfile,
  DeleteAppleProvisioningProfileResult,
  GenerateAppleProvisioningProfileBody,
  ListAppleProvisioningProfilesParams,
  UploadAppleProvisioningProfileBody,
} from "../domain/apple-provisioning-profile";
import { BadRequest, Conflict } from "../domain/errors";

const idParam = HttpApiSchema.param("id", Schema.String);

export class AppleProvisioningProfilesGroup extends HttpApiGroup.make("appleProvisioningProfiles")
  .add(
    HttpApiEndpoint.get("list", "/api/apple/provisioning-profiles")
      .setUrlParams(ListAppleProvisioningProfilesParams)
      .addSuccess(Schema.Struct({ items: Schema.Array(AppleProvisioningProfile) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List provisioning profiles",
          description: "List stored provisioning profiles, optionally filtered by bundle + team",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("upload", "/api/apple/provisioning-profiles")
      .setPayload(UploadAppleProvisioningProfileBody)
      .addSuccess(AppleProvisioningProfile, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Upload provisioning profile",
          description: "Upload an existing .mobileprovision; auto-parses the embedded plist",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("generate", "/api/apple/provisioning-profiles/generate")
      .setPayload(GenerateAppleProvisioningProfileBody)
      .addSuccess(AppleProvisioningProfile, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Generate provisioning profile",
          description: "Generate + download a new provisioning profile via App Store Connect API",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/apple/provisioning-profiles/${idParam}`
      .addSuccess(DeleteAppleProvisioningProfileResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete provisioning profile",
          description: "Remove a stored provisioning profile",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Apple Provisioning Profiles",
      description: "Manage .mobileprovision profiles (upload or generate)",
    }),
  ) {}
