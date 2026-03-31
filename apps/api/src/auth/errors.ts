import { HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  HttpApiSchema.annotations({ status: 401 }),
) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()(
  "Forbidden",
  { message: Schema.String },
  HttpApiSchema.annotations({ status: 403 }),
) {}

export class OrgRequired extends Schema.TaggedError<OrgRequired>()(
  "OrgRequired",
  { message: Schema.String },
  HttpApiSchema.annotations({ status: 400 }),
) {}
