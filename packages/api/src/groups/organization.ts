import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { Conflict } from "../domain/errors";
import { Organization, UpdateOrganizationBody } from "../domain/organization";

// IAM-gated active-organization settings. Org CREATE stays on better-auth (a
// pre-org platform/approval gate IAM cannot evaluate); org DELETE stays on
// better-auth too (owner-only; its cross-table cascade is delegated there). Org
// UPDATE is an in-org mutation with full actor context, so it gates here on
// `assertAccess("organization","update")`.
export class OrganizationGroup extends HttpApiGroup.make("organization")
  .add(
    HttpApiEndpoint.patch("update", "/api/organization")
      .setPayload(UpdateOrganizationBody)
      .addSuccess(Organization)
      .annotateContext(
        OpenApi.annotations({
          title: "Update organization",
          description:
            "Rename / re-slug the active organization (IAM-gated by organization:update)",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Organization",
      description: "IAM-gated active-organization settings",
    }),
  ) {}
