const apiFetch = async (method: string, path: string, body?: unknown) =>
  fetch(path, {
    method,
    ...(body !== undefined && {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    credentials: "include" as RequestCredentials,
  });

export const apiGet = async (path: string) => apiFetch("GET", path);

export const apiPost = async (path: string, body: unknown) => apiFetch("POST", path, body);

export const apiPatch = async (path: string, body: unknown) => apiFetch("PATCH", path, body);

export const getResponseError = async (response: Response): Promise<string> => {
  const body: unknown = await response.json().catch(() => null);
  if (
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string"
  ) {
    return body.message;
  }
  return response.statusText;
};
