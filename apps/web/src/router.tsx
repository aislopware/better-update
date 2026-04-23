import "./app.css";

import { configureApiBaseUrl } from "@better-update/api-client";
import { QueryClient, defaultShouldDehydrateQuery } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { routeTree } from "./routeTree.gen";

// eslint-disable-next-line eslint-js/no-restricted-syntax -- Vite build-time env; empty fallback resolves API calls against current origin via Vite dev proxy.
const apiBaseUrl: string = import.meta.env.VITE_API_URL ?? "";
configureApiBaseUrl(apiBaseUrl);

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
      },
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === "pending",
      },
    },
  });

  const router = createRouter({
    context: { queryClient },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: () => <div className="p-8 text-sm">Not found</div>,
    routeTree,
    scrollRestoration: true,
  });

  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
