import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { Suspense } from "react";

import type { ReactElement } from "react";

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
      <Suspense fallback={null}>{ui}</Suspense>
    </QueryClientProvider>,
  );

  return { ...result, queryClient };
};
