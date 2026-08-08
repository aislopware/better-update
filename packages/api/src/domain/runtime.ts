import { Schema } from "effect";

import { DateTimeString, Id, PaginationParams, Platform } from "./common";

// Aggregated view of one runtime version across a project's builds and updates.
export class RuntimeAggregate extends Schema.Class<RuntimeAggregate>("RuntimeAggregate")({
  version: Schema.String,
  // Which platforms report this runtime — a version that only one of them ever
  // shipped is the kind of thing a reader is scanning the list for.
  platforms: Schema.Array(Platform),
  buildsCount: Schema.Number,
  updatesCount: Schema.Number,
  latestActivity: DateTimeString,
}) {}

export const ListRuntimesParams = Schema.Struct({
  projectId: Id,
  ...PaginationParams.fields,
});
