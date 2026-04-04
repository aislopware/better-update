import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export interface SessionResponse {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    emailVerified: boolean;
    activeOrganizationId: string | null;
  };
  session: {
    id: string;
    token: string;
    expiresAt: string;
  };
}

const isSessionResponse = (value: unknown): value is SessionResponse =>
  typeof value === "object" && value !== null && "user" in value && "session" in value;

export interface OrgResponse {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  createdAt: string;
}

const isOrgArray = (value: unknown): value is OrgResponse[] =>
  Array.isArray(value) &&
  value.every(
    (item) => typeof item === "object" && item !== null && "id" in item && "slug" in item,
  );

export const getSessionFn = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const cookie = request.headers.get("cookie") ?? "";

  if (!cookie) {
    return null;
  }

  const { env } = await import("cloudflare:workers");
  const response = await env.API.fetch("https://internal/api/auth/get-session", {
    headers: { cookie },
  });

  if (!response.ok) {
    return null;
  }

  const json: unknown = JSON.parse(await response.text());

  return isSessionResponse(json) ? json : null;
});

export const getOrgsFn = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const cookie = request.headers.get("cookie") ?? "";

  if (!cookie) {
    return [] as OrgResponse[];
  }

  const { env } = await import("cloudflare:workers");
  const response = await env.API.fetch("https://internal/api/auth/organization/list", {
    headers: { cookie },
  });

  if (!response.ok) {
    return [] as OrgResponse[];
  }

  const json: unknown = JSON.parse(await response.text());

  return isOrgArray(json) ? json : [];
});
