import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { DeletedResult } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";
import { AvatarResult, AvatarUploadBody, AvatarUploadResult, Me } from "../domain/me";

export const MeGroup = HttpApiGroup.make("me")
  .add(
    HttpApiEndpoint.get("get", "/api/me", {
      success: Me,
      error: [NotFound, BadRequest, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Get current actor",
        description:
          "Return the authenticated user + active organization. Useful for `whoami` and to verify the CLI's auth state.",
      }),
    ),
    HttpApiEndpoint.post("createAvatarUploadUrl", "/api/me/avatar/upload-url", {
      payload: AvatarUploadBody,
      success: AvatarUploadResult,
      error: [NotFound, BadRequest, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Create avatar upload URL",
        description:
          "Request a presigned PUT URL to upload the current user's avatar directly to object " +
          "storage. Send the returned headers with the upload, then call “Set avatar” to finalize.",
      }),
    ),
    HttpApiEndpoint.put("setAvatar", "/api/me/avatar", {
      success: AvatarResult,
      error: [NotFound, BadRequest, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Set avatar",
        description:
          "Finalize the current user's avatar after its bytes were uploaded via the presigned " +
          "URL: validates the stored object and returns its public CDN URL to persist on the user.",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("removeAvatar", "/api/me/avatar", {
      success: DeletedResult,
      error: [NotFound, BadRequest, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Remove avatar",
        description: "Delete the current user's stored avatar object from object storage.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Me",
      description: "Current authenticated actor information",
    }),
  );
