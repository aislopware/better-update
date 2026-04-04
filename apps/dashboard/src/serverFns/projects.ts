import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export interface ProjectItem {
  id: string;
  organizationId: string;
  name: string;
  scopeKey: string;
  createdAt: string;
}

interface ProjectListResponse {
  items: ProjectItem[];
  total: number;
  page: number;
  limit: number;
}

const isProjectListResponse = (value: unknown): value is ProjectListResponse =>
  typeof value === "object" &&
  value !== null &&
  "items" in value &&
  Array.isArray((value as { items: unknown }).items) &&
  "total" in value &&
  typeof (value as { total: unknown }).total === "number";

export const getProjectsFn = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const cookie = request.headers.get("cookie") ?? "";

  if (!cookie) {
    return { items: [], total: 0, page: 1, limit: 20 } as ProjectListResponse;
  }

  const { env } = await import("cloudflare:workers");
  const response = await env.API.fetch("https://internal/api/projects", {
    headers: { cookie },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }

  const json: unknown = JSON.parse(await response.text());

  if (!isProjectListResponse(json)) {
    throw new Error("Invalid projects response");
  }

  return json;
});
