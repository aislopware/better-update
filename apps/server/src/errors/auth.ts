import { Schema } from "effect";

export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {
  message: Schema.String,
}) {}

export class OrgRequired extends Schema.TaggedError<OrgRequired>()("OrgRequired", {
  message: Schema.String,
}) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {
  message: Schema.String,
}) {}
