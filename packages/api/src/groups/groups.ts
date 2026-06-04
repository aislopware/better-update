import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { DeletedResult, Id, idParam } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";
import {
  AddGroupMemberBody,
  CreateGroupBody,
  Group,
  GroupMember,
  UpdateGroupBody,
} from "../domain/group";

/** `:memberId` path parameter — the `member.id` of a group member. */
const memberIdParam = HttpApiSchema.param("memberId", Id);

export class GroupsGroup extends HttpApiGroup.make("groups")
  .add(
    HttpApiEndpoint.get("list", "/api/groups")
      .addSuccess(Schema.Struct({ items: Schema.Array(Group) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List groups",
          description: "List member groups in the active organization",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("create", "/api/groups")
      .setPayload(CreateGroupBody)
      .addSuccess(Group, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Create group",
          description: "Create a member group for the active organization",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("get")`/api/groups/${idParam}`.addSuccess(Group).annotateContext(
      OpenApi.annotations({
        title: "Get group",
        description: "Fetch a single group by id",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("update")`/api/groups/${idParam}`
      .setPayload(UpdateGroupBody)
      .addSuccess(Group)
      .annotateContext(
        OpenApi.annotations({
          title: "Update group",
          description: "Update a group's name or description",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/groups/${idParam}`.addSuccess(DeletedResult).annotateContext(
      OpenApi.annotations({
        title: "Delete group",
        description: "Delete a group and sweep its memberships and policy attachments",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("listMembers")`/api/groups/${idParam}/members`
      .addSuccess(Schema.Struct({ items: Schema.Array(GroupMember) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List group members",
          description: "List the members belonging to a group",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("addMember")`/api/groups/${idParam}/members`
      .setPayload(AddGroupMemberBody)
      .addSuccess(GroupMember, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Add group member",
          description: "Add an organization member to a group",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("removeMember")`/api/groups/${idParam}/members/${memberIdParam}`
      .addSuccess(DeletedResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Remove group member",
          description: "Remove a member from a group",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Groups",
      description: "Member groups for collective policy attachment",
    }),
  ) {}
