import { BUILTIN_ENVIRONMENTS } from "@better-update/api";
import { environmentsQueryOptions } from "@better-update/api-client/react";
import { useQuery } from "@tanstack/react-query";

/** Built-in environment names — the fallback before the environments query resolves. */
export const BUILTIN_ENVIRONMENT_NAMES: readonly string[] = [...BUILTIN_ENVIRONMENTS];

/**
 * The org's environment names (built-ins + user-defined) for filters and
 * pickers. Falls back to the built-ins while the query is in flight.
 */
export const useEnvironmentNames = (orgId: string): readonly string[] => {
  const { data } = useQuery(environmentsQueryOptions(orgId));
  return data ? data.items.map((environment) => environment.name) : BUILTIN_ENVIRONMENT_NAMES;
};
