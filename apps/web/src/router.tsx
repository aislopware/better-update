import "./app.css";

import { configureApiBaseUrl, getTypedApiError } from "@better-update/api-client";
import { Button } from "@better-update/ui/components/ui/button";
import { QueryClient, defaultShouldDehydrateQuery } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { QueryErrorState } from "./components/query-error-state";
import { routeTree } from "./routeTree.gen";

// eslint-disable-next-line eslint-js/no-restricted-syntax -- Vite build-time env; empty fallback resolves API calls against current origin via Vite dev proxy.
const apiBaseUrl: string = import.meta.env.VITE_API_URL ?? "";
configureApiBaseUrl(apiBaseUrl);

const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  if (error === undefined) {
    return "undefined (a non-Error value was thrown — check the call stack)";
  }
  if (error === null) {
    return "null";
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object") {
    const seen = new WeakSet<object>();
    return JSON.stringify(
      error,
      (_key, value: unknown) => {
        if (typeof value !== "object" || value === null) {
          return value;
        }
        if (seen.has(value)) {
          return "[Circular]";
        }
        seen.add(value);
        return value;
      },
      2,
    );
  }
  // eslint-disable-next-line typescript-eslint/no-base-to-string -- error is now `number | bigint | boolean | symbol`; primitive String() is safe and the fallback we want
  return String(error);
};

interface RouterErrorInfo {
  readonly componentStack?: string;
}

const RouterErrorFallback = ({
  error,
  reset,
  info,
}: {
  error: unknown;
  reset: () => void;
  info?: RouterErrorInfo;
}) =>
  // Typed API failures (Forbidden, NotFound, …) get the user-facing error
  // surface; everything else keeps the developer-oriented stack dump.
  getTypedApiError(error) ? (
    <div className="mx-auto w-full max-w-3xl p-8">
      <QueryErrorState error={error} onRetry={reset} />
    </div>
  ) : (
    <div className="mx-auto flex max-w-3xl flex-col items-start gap-4 p-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">Something went wrong</h2>
        <p className="text-muted-foreground text-sm">A route failed to load.</p>
      </div>
      <pre className="bg-muted/40 max-h-96 w-full overflow-auto rounded-md border p-3 text-xs leading-relaxed whitespace-pre-wrap">
        {formatError(error)}
      </pre>
      {info?.componentStack ? (
        <details className="w-full">
          <summary className="text-muted-foreground cursor-pointer text-xs">
            Component stack
          </summary>
          <pre className="bg-muted/40 mt-2 max-h-72 w-full overflow-auto rounded-md border p-3 text-xs leading-relaxed whitespace-pre-wrap">
            {info.componentStack}
          </pre>
        </details>
      ) : null}
      <Button type="button" variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  );

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        // Tagged API errors (Forbidden, NotFound, …) are deterministic 4xx
        // responses — retrying only delays the error surface.
        retry: (failureCount, error) => getTypedApiError(error) === null && failureCount < 3,
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
    defaultErrorComponent: RouterErrorFallback,
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
