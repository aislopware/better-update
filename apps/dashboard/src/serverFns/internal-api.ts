import { getRequest } from "@tanstack/react-start/server";

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export const isPaginatedResponse = (value: unknown): value is PaginatedResponse<unknown> =>
  typeof value === "object" &&
  value !== null &&
  "items" in value &&
  Array.isArray((value as { items: unknown }).items) &&
  "total" in value &&
  typeof (value as { total: unknown }).total === "number";

export const fetchInternalApi = async <T>(
  path: string,
  guard: (value: unknown) => value is T,
  emptyValue: T,
): Promise<T> => {
  const request = getRequest();
  const cookie = request.headers.get("cookie") ?? "";

  if (!cookie) {
    return emptyValue;
  }

  const { env } = await import("cloudflare:workers");
  const response = await env.API.fetch(`https://internal${path}`, {
    headers: { cookie },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }

  const json: unknown = await response.json();

  if (guard(json)) {
    return json;
  }

  throw new Error(`Invalid response from ${path}`);
};
