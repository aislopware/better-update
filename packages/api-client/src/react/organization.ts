import { OrganizationLogoContentType } from "@better-update/api";
import { Effect } from "effect";

import type { UpdateOrganizationBody } from "@better-update/api";

import { runApi } from "../index";

// Update the active organization's settings (name/slug) via the IAM-gated
// PATCH /api/organization endpoint (organization:update), replacing the
// better-auth organization.update route.
export const updateOrganization = async (body: typeof UpdateOrganizationBody.Type) =>
  runApi((api) => api.organization.update({ payload: body }));

/** MIME types the organization logo upload accepts (mirrors the server schema). */
export type OrganizationLogoContentTypeValue = typeof OrganizationLogoContentType.Type;

export const isOrganizationLogoContentType = (
  value: string,
): value is OrganizationLogoContentTypeValue =>
  (OrganizationLogoContentType.literals as readonly string[]).includes(value);

// Reject a mutation the functional way (no `throw`/`Promise.reject`): a failed
// Effect run rejects with a FiberFailure that `getApiError` reads the message off.
const failMutation = async (message: string): Promise<never> =>
  Effect.runPromise(Effect.fail(new Error(message)));

/**
 * Upload the active organization's logo end-to-end: request a presigned PUT,
 * upload the bytes directly to object storage with the signed headers, then
 * finalize so the server records the public CDN URL. Returns the updated
 * organization. API-call failures keep their typed errors (they propagate from
 * `runApi`).
 */
export const uploadOrganizationLogo = async (file: File) => {
  if (!isOrganizationLogoContentType(file.type)) {
    return failMutation("Unsupported image type. Use PNG, JPEG, WebP, or SVG.");
  }
  const contentType = file.type;

  const { uploadUrl, uploadHeaders } = await runApi((api) =>
    api.organization.createLogoUploadUrl({ payload: { contentType } }),
  );

  const response = await fetch(uploadUrl, { method: "PUT", headers: uploadHeaders, body: file });
  if (!response.ok) {
    return failMutation(`Logo upload failed (${response.status})`);
  }

  return runApi((api) => api.organization.setLogo());
};

export const removeOrganizationLogo = async () => runApi((api) => api.organization.removeLogo());
