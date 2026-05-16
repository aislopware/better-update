import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { Suspense } from "react";

import type { ReactElement } from "react";

const testRouter = createRouter({
  routeTree: createRootRoute(),
  history: createMemoryHistory({ initialEntries: ["/"] }),
});

export const renderWithQuery = (
  ui: ReactElement,
  options?: {
    seedCache?: [readonly unknown[], unknown][];
  },
) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });

  if (options?.seedCache) {
    options.seedCache.forEach(([key, data]) => {
      queryClient.setQueryData(key, data);
    });
  }

  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={testRouter}>
        <Suspense fallback={null}>{ui}</Suspense>
      </RouterContextProvider>
    </QueryClientProvider>,
  );

  return { ...result, queryClient };
};
