import { queryOptions } from "@tanstack/react-query";

import { getThemeFromCookie } from "../lib/theme";

export const themeQueryOptions = queryOptions({
  queryKey: ["theme"],
  queryFn: () => getThemeFromCookie(),
  staleTime: Number.POSITIVE_INFINITY,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
});
