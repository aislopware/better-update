import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  AppleProvisioningProfile,
  DeleteAppleProvisioningProfileResult,
  DownloadAppleProvisioningProfileResult,
  ListAppleProvisioningProfilesParams,
  UploadAppleProvisioningProfileBody,
} from "../domain/apple-provisioning-profile";
import { idParam } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";

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
          description:
            "Upload an existing or freshly generated .mobileprovision; auto-parses the embedded plist",
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
  .add(
    HttpApiEndpoint.get("download")`/api/apple/provisioning-profiles/${idParam}/download`
      .addSuccess(DownloadAppleProvisioningProfileResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Download provisioning profile",
          description: "Fetch the decoded .mobileprovision for local use (audit-logged)",
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
