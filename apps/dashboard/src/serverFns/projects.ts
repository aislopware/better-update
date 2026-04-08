import { createServerFn } from "@tanstack/react-start";

import type { Project } from "@better-update/api";

import { fetchInternalApi, isPaginatedResponse } from "./internal-api";

import type { PaginatedResponse } from "./internal-api";

export type ProjectItem = typeof Project.Type;

type ProjectListResponse = PaginatedResponse<ProjectItem>;

export const getProjectsFn = createServerFn({ method: "GET" }).handler(async () =>
  fetchInternalApi(
    "/api/projects",
    (value): value is ProjectListResponse => isPaginatedResponse(value),
    { items: [], total: 0, page: 1, limit: 20 } as ProjectListResponse,
  ),
);
