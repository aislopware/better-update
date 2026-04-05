import { queryOptions } from "@tanstack/react-query";

import { getThemeFn } from "../serverFns/theme";

export const themeQueryOptions = queryOptions({
  queryKey: ["theme"],
  queryFn: async () => getThemeFn(),
  staleTime: Number.POSITIVE_INFINITY,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
});
