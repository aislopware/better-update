import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

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

export const AppleProvisioningProfilesGroup = HttpApiGroup.make("appleProvisioningProfiles")
  .add(
    HttpApiEndpoint.get("list", "/api/apple/provisioning-profiles", {
      query: ListAppleProvisioningProfilesParams,
      success: Schema.Struct({ items: Schema.Array(AppleProvisioningProfile) }),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List provisioning profiles",
        description: "List stored provisioning profiles, optionally filtered by bundle + team",
      }),
    ),
    HttpApiEndpoint.post("upload", "/api/apple/provisioning-profiles", {
      payload: UploadAppleProvisioningProfileBody,
      success: AppleProvisioningProfile.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Upload provisioning profile",
        description:
          "Upload an existing or freshly generated .mobileprovision; auto-parses the embedded plist",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/apple/provisioning-profiles/:id", {
      params: { ...idParam },
      success: DeleteAppleProvisioningProfileResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete provisioning profile",
        description: "Remove a stored provisioning profile",
      }),
    ),
    HttpApiEndpoint.get("download", "/api/apple/provisioning-profiles/:id/download", {
      params: { ...idParam },
      success: DownloadAppleProvisioningProfileResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Download provisioning profile",
        description: "Fetch the decoded .mobileprovision for local use (audit-logged)",
      }),
    ),
    HttpApiEndpoint.put("protect", "/api/apple/provisioning-profiles/:id/protection", {
      params: { ...idParam },
      success: AppleProvisioningProfile,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Protect credential",
        description:
          "Mark the provisioning profile protected (GITLAB-RBAC-SPEC §3b): reads/uses require Maintainer+. Org admin only. Idempotent.",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("unprotect", "/api/apple/provisioning-profiles/:id/protection", {
      params: { ...idParam },
      success: AppleProvisioningProfile,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Unprotect credential",
        description: "Remove the profile's protection. Org admin only. Idempotent.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Apple Provisioning Profiles",
      description: "Manage .mobileprovision profiles (upload or generate)",
    }),
  );
