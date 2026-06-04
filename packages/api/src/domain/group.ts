import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

export class Group extends Schema.Class<Group>("Group")({
  id: Id,
  organizationId: Id,
  name: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.String),
  createdAt: DateTimeString,
  updatedAt: Schema.NullOr(DateTimeString),
}) {}

export const CreateGroupBody = Schema.Struct({
  name: Schema.NonEmptyString,
  description: Schema.optional(Schema.String),
});

export const UpdateGroupBody = Schema.Struct({
  name: Schema.optional(Schema.NonEmptyString),
  description: Schema.optional(Schema.NullOr(Schema.String)),
});

export class GroupMember extends Schema.Class<GroupMember>("GroupMember")({
  memberId: Id,
  createdAt: DateTimeString,
}) {}

export const AddGroupMemberBody = Schema.Struct({
  memberId: Id,
});
