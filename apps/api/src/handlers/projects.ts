import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { Project } from "../domain/project";

const stubProject = new Project({
  id: "00000000-0000-0000-0000-000000000000",
  organizationId: "00000000-0000-0000-0000-000000000000",
  name: "stub-project",
  scopeKey: "@stub/project",
  createdAt: "2026-01-01T00:00:00Z",
});

export const ProjectsGroupLive = HttpApiBuilder.group(ManagementApi, "projects", (handlers) =>
  handlers
    .handle("create", () => Effect.succeed(stubProject))
    .handle("list", () => Effect.succeed({ items: [], total: 0, page: 1, limit: 20 })),
);
