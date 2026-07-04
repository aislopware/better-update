import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { DeletedResult } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";
import { AvatarResult, AvatarUploadBody, AvatarUploadResult, Me } from "../domain/me";

export class MeGroup extends HttpApiGroup.make("me")
  .add(
    HttpApiEndpoint.get("get", "/api/me")
      .addSuccess(Me)
      .annotateContext(
        OpenApi.annotations({
          title: "Get current actor",
          description:
            "Return the authenticated user + active organization. Useful for `whoami` and to verify the CLI's auth state.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("createAvatarUploadUrl", "/api/me/avatar/upload-url")
      .setPayload(AvatarUploadBody)
      .addSuccess(AvatarUploadResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Create avatar upload URL",
          description:
            "Request a presigned PUT URL to upload the current user's avatar directly to object " +
            "storage. Send the returned headers with the upload, then call “Set avatar” to finalize.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("setAvatar", "/api/me/avatar")
      .addSuccess(AvatarResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Set avatar",
          description:
            "Finalize the current user's avatar after its bytes were uploaded via the presigned " +
            "URL: validates the stored object and returns its public CDN URL to persist on the user.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("removeAvatar", "/api/me/avatar")
      .addSuccess(DeletedResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Remove avatar",
          description: "Delete the current user's stored avatar object from object storage.",
        }),
      ),
  )
  .addError(NotFound)
  .addError(BadRequest)
  .addError(Conflict)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Me",
      description: "Current authenticated actor information",
    }),
  ) {}
