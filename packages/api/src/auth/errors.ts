import { Schema } from "effect";

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()(
  "Forbidden",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}

export class OrgRequired extends Schema.TaggedError<OrgRequired>()(
  "OrgRequired",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}
