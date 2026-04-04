import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";

const handler = createStartHandler(defaultStreamHandler);

export default createServerEntry({
  async fetch(request, ...args) {
    const url = new URL(request.url);

    // Proxy /api/* requests to the API worker via service binding
    if (url.pathname.startsWith("/api/")) {
      const { env } = await import("cloudflare:workers");
      return env.API.fetch(request);
    }

    return handler(request, ...args);
  },
});
