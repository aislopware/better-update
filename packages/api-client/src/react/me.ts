import { AvatarContentType } from "@better-update/api";
import { Effect } from "effect";

import { runApi } from "../index";

/** MIME types the user avatar upload accepts (mirrors the server schema). */
export type AvatarContentTypeValue = typeof AvatarContentType.Type;

export const isAvatarContentType = (value: string): value is AvatarContentTypeValue =>
  (AvatarContentType.literals as readonly string[]).includes(value);

// Reject a mutation the functional way (no `throw`/`Promise.reject`): a failed
// Effect run rejects with a FiberFailure that `getApiError` reads the message off.
const failMutation = async (message: string): Promise<never> =>
  Effect.runPromise(Effect.fail(new Error(message)));

/**
 * Upload the current user's avatar end-to-end: request a presigned PUT, upload
 * the bytes directly to object storage with the signed headers, then finalize so
 * the server validates the stored object and returns its public CDN URL. The
 * caller persists that URL on the user via the auth client (better-auth owns the
 * user.image column). API-call failures keep their typed errors.
 */
export const uploadUserAvatar = async (file: File): Promise<string> => {
  if (!isAvatarContentType(file.type)) {
    return failMutation("Unsupported image type. Use PNG, JPEG, WebP, or SVG.");
  }
  const contentType = file.type;

  const { uploadUrl, uploadHeaders } = await runApi((api) =>
    api.me.createAvatarUploadUrl({ payload: { contentType } }),
  );

  const response = await fetch(uploadUrl, { method: "PUT", headers: uploadHeaders, body: file });
  if (!response.ok) {
    return failMutation(`Avatar upload failed (${response.status})`);
  }

  const { imageUrl } = await runApi((api) => api.me.setAvatar());
  return imageUrl;
};

/** Delete the current user's stored avatar object. The caller then clears user.image. */
export const removeUserAvatar = async () => runApi((api) => api.me.removeAvatar());
