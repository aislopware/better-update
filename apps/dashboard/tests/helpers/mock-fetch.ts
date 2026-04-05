type RouteHandler = (req: Request) => Response | Promise<Response>;

const BASE = "http://localhost";

export const mockFetch = (routes: Record<string, RouteHandler>) => {
  const resolveUrl = (input: RequestInfo | URL): string => {
    if (typeof input === "string") {
      return input;
    }
    if (input instanceof URL) {
      return input.href;
    }
    return input.url;
  };

  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveUrl(input);
    const method = init?.method ?? "GET";
    const absoluteUrl = url.startsWith("/") ? `${BASE}${url}` : url;
    const { pathname } = new URL(absoluteUrl);
    const key = `${method} ${pathname}`;

    const handler = routes[key];
    if (handler) {
      const request = new Request(absoluteUrl, init);
      return handler(request);
    }

    // Also try path-only match (method-agnostic)
    const pathHandler = routes[pathname];
    if (pathHandler) {
      const request = new Request(absoluteUrl, init);
      return pathHandler(request);
    }

    return new Response("Not Found", { status: 404 });
  });

  vi.stubGlobal("fetch", mock);
  return mock;
};
