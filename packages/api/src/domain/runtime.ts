import { Schema } from "effect";

import { DateTimeString, Id, PaginationParams } from "./common";

// Aggregated view of one runtime version across a project's builds and updates.
export class RuntimeAggregate extends Schema.Class<RuntimeAggregate>("RuntimeAggregate")({
  version: Schema.String,
  buildsCount: Schema.Number,
  updatesCount: Schema.Number,
  latestActivity: DateTimeString,
}) {}

export const ListRuntimesParams = Schema.Struct({
  projectId: Id,
  ...PaginationParams.fields,
});
