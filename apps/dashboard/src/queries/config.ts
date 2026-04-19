import { queryOptions } from "@tanstack/react-query";

interface ServerConfig {
  readonly githubEnabled: boolean;
}

const fetchServerConfig = async (): Promise<ServerConfig> => {
  const response = await fetch("/api/config", { credentials: "include" });
  if (!response.ok) {
    return { githubEnabled: false };
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
