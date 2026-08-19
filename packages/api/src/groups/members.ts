import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { DeletedResult, idParam } from "../domain/common";
import { Conflict } from "../domain/errors";
import {
  AllProjectsMembership,
  MemberProjectMembershipsList,
  SetAllProjectsMembershipBody,
} from "../domain/project-member";

const UpdateMemberRoleBody = Schema.Struct({
  role: Schema.Literals(["admin", "member"]),
});

const UpdatedMemberRole = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["admin", "member"]),
});

export const MembersGroup = HttpApiGroup.make("members")
  .add(
    HttpApiEndpoint.patch("updateRole", "/api/members/:id", {
      params: { ...idParam },
      payload: UpdateMemberRoleBody,
      success: UpdatedMemberRole,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Change member org role",
        description:
          "Set a member's org role (GITLAB-RBAC-SPEC §2): admin ⇄ member. Requires member:update; granting OR revoking admin is owner-only. Owners cannot be changed here (owner is the org root, set at creation).",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("remove", "/api/members/:id", {
      params: { ...idParam },
      success: DeletedResult,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Remove member",
        description:
          "Remove a member from the active organization by member id (org-scoped; no cross-organization removes). Rejects removing the last owner (409). Also drops the member's project_member rows.",
      }),
    ),
    HttpApiEndpoint.get("listProjectMemberships", "/api/members/project-memberships", {
      success: MemberProjectMembershipsList,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List member project memberships",
        description:
          "Every member's project memberships in the active org: explicit project_member rows (project names embedded) plus the org-wide 'all projects' role when granted. Org owner/admin are implicit maintainers everywhere and carry no rows. Requires member:read (any org member).",
      }),
    ),
    HttpApiEndpoint.put("setAllProjects", "/api/members/:id/all-projects", {
      params: { ...idParam },
      payload: SetAllProjectsMembershipBody,
      success: AllProjectsMembership,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Grant org-wide project membership",
        description:
          "Give the member the role on EVERY project of the org — present and future — resolved at query time like org-wide credential bindings (idempotent upsert). Explicit per-project rows still apply; the higher role wins. Requires member:update. Owners are rejected (implicit maintainers).",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("removeAllProjects", "/api/members/:id/all-projects", {
      params: { ...idParam },
      success: DeletedResult,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Revoke org-wide project membership",
        description:
          "Drop the member's org-wide 'all projects' role. Explicit per-project memberships are untouched — access falls back to them. Requires member:update.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Members",
      description: "IAM-gated organization member management (org role + removal)",
    }),
  );
