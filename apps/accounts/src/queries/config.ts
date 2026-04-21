import { queryOptions } from "@tanstack/react-query";

interface ServerConfig {
  readonly githubEnabled: boolean;
  readonly passwordEnabled: boolean;
}

// eslint-disable-next-line eslint-js/no-restricted-syntax -- Vite build-time env; empty fallback resolves `/api/config` against current origin via Vite dev proxy.
const apiBaseUrl: string = import.meta.env.VITE_API_URL ?? "";

const fetchServerConfig = async (): Promise<ServerConfig> => {
  const response = await fetch(`${apiBaseUrl}/api/config`, {
    credentials: "include",
  });
  if (!response.ok) {
    return { githubEnabled: false, passwordEnabled: false };
  }
  return response.json();
};

export const configQueryOptions = queryOptions({
  queryKey: ["config", "server"],
  queryFn: fetchServerConfig,
  staleTime: Infinity,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
});
