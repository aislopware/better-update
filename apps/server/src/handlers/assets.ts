import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";

export const AssetsGroupLive = HttpApiBuilder.group(ManagementApi, "assets", (handlers) =>
  handlers.handle("upload", () => Effect.succeed({ uploaded: [], deduplicated: [] })),
);
