import { queryOptions } from "@tanstack/react-query";
import { Duration } from "effect";

import { authClient } from "../lib/auth-client";

const FIVE_MINUTES_MS = Duration.toMillis(Duration.minutes(5));
const ONE_MINUTE_MS = Duration.toMillis(Duration.minutes(1));

const loadSession = async () => {
  const { data } = await authClient.getSession();
  return data;
};

const loadAccounts = async () => {
  const { data } = await authClient.listAccounts();
  return data === null ? [] : data;
};

const loadSessions = async () => {
  const { data } = await authClient.listSessions();
  return data === null ? [] : data;
};

const loadOrgs = async () => {
  const { data } = await authClient.organization.list();
  return data ?? [];
};

export const sessionQueryOptions = queryOptions({
  queryKey: ["auth", "session"],
  queryFn: loadSession,
  staleTime: FIVE_MINUTES_MS,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
});

export const orgsQueryOptions = queryOptions({
  queryKey: ["auth", "orgs"],
  queryFn: loadOrgs,
  staleTime: FIVE_MINUTES_MS,
});

export const accountsQueryOptions = queryOptions({
  queryKey: ["auth", "accounts"],
  queryFn: loadAccounts,
  staleTime: FIVE_MINUTES_MS,
});

export const sessionsQueryOptions = queryOptions({
  queryKey: ["auth", "sessions"],
  queryFn: loadSessions,
  staleTime: ONE_MINUTE_MS,
});
