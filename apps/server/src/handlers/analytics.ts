import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";

export const AnalyticsGroupLive = HttpApiBuilder.group(ManagementApi, "analytics", (handlers) =>
  handlers
    .handle("adoption", () => Effect.succeed({ entries: [] }))
    .handle("updates", () => Effect.succeed({ entries: [] }))
    .handle("channels", () => Effect.succeed({ entries: [] }))
    .handle("platforms", () => Effect.succeed({ entries: [] })),
);
