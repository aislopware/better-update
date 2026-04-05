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

export interface ApiKeyResponse {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  createdAt: string;
  expiresAt: string | null;
}

const isApiKeyArray = (value: unknown): value is ApiKeyResponse[] =>
  Array.isArray(value) &&
  value.every((item) => typeof item === "object" && item !== null && "id" in item);

export const getApiKeysFn = createServerFn({ method: "GET" })
  .inputValidator((input: { organizationId: string }) => input)
  .handler(async ({ data: { organizationId } }) => {
    const request = getRequest();
    const cookie = request.headers.get("cookie") ?? "";

    if (!cookie) {
      return [] as ApiKeyResponse[];
    }

    const { env } = await import("cloudflare:workers");
    const url = `https://internal/api/auth/api-key/list?organizationId=${encodeURIComponent(organizationId)}`;
    const response = await env.API.fetch(url, {
      headers: { cookie },
    });

    if (!response.ok) {
      return [] as ApiKeyResponse[];
    }

    const json: unknown = JSON.parse(await response.text());

    if (typeof json === "object" && json !== null && "apiKeys" in json) {
      const { apiKeys } = json as { apiKeys: unknown };
      return isApiKeyArray(apiKeys) ? apiKeys : [];
    }

    return [] as ApiKeyResponse[];
  });
