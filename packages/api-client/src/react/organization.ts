import type { UpdateOrganizationBody } from "@better-update/api";

import { runApi } from "../index";

// Update the active organization's settings (name/slug) via the IAM-gated
// PATCH /api/organization endpoint (organization:update), replacing the
// better-auth organization.update route.
export const updateOrganization = async (body: typeof UpdateOrganizationBody.Type) =>
  runApi((api) => api.organization.update({ payload: body }));
