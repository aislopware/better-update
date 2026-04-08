import { createServerFn } from "@tanstack/react-start";

import type { Project } from "@better-update/api";

import { fetchInternalApi } from "./internal-api";

export type ProjectDetail = typeof Project.Type;

const isProjectResponse = (value: unknown): value is ProjectDetail =>
  typeof value === "object" && value !== null && "id" in value && "name" in value;

export const getProjectFn = createServerFn({ method: "GET" })
  .inputValidator((input: { projectId: string }) => input)
  .handler(async ({ data }) =>
    fetchInternalApi(`/api/projects/${encodeURIComponent(data.projectId)}`, isProjectResponse, {
      id: data.projectId,
      organizationId: "",
      name: "Project",
      scopeKey: "",
      createdAt: "",
    } as ProjectDetail),
  );
