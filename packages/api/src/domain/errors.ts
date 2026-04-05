import { HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

export class Conflict extends Schema.TaggedError<Conflict>()(
  "Conflict",
  { message: Schema.String },
  HttpApiSchema.annotations({ status: 409 }),
) {}
