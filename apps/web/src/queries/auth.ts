import { queryOptions } from "@tanstack/react-query";
import { Duration } from "effect";

import { authClient } from "../lib/auth-client";
import { ensureError } from "../lib/ensure-error";

const FIVE_MINUTES_MS = Duration.toMillis(Duration.minutes(5));
const ONE_MINUTE_MS = Duration.toMillis(Duration.minutes(1));
// Session + orgs are read by `_authed.tsx` / `auth.tsx` `beforeLoad`. Setting staleTime to Infinity
// Keeps them out of stale-while-revalidate, which avoids a TanStack Router race where loadPromise
// Is cleared mid-render and Suspense throws undefined. Invalidate manually on login/logout/org-switch.

/* eslint-disable functional/no-try-statements, functional/no-promise-reject, functional/no-throw-statements -- queryFn must throw a real Error so TanStack Router/Query CatchBoundary's `if (error)` truthy check works; non-Error rejects (e.g. better-auth throwing undefined) crash render with `Uncaught undefined` */
const loadSession = async () => {
  try {
    const { data } = await authClient.getSession();
    return data;
  } catch (error) {
    throw ensureError(error, "Failed to load session");
  }
};

const loadAccounts = async () => {
  try {
    const { data } = await authClient.listAccounts();
    return data === null ? [] : data;
  } catch (error) {
    throw ensureError(error, "Failed to load accounts");
  }
};

const loadSessions = async () => {
  try {
    const { data } = await authClient.listSessions();
    return data === null ? [] : data;
  } catch (error) {
    throw ensureError(error, "Failed to load sessions");
  }
};

const loadOrgs = async () => {
  try {
    const { data } = await authClient.organization.list({
      fetchOptions: { disableSignal: true },
    });
    return data ?? [];
  } catch (error) {
    throw ensureError(error, "Failed to load organizations");
  }
};

const loadPasskeys = async () => {
  try {
    const { data } = await authClient.passkey.listUserPasskeys();
    return data === null ? [] : data;
  } catch (error) {
    throw ensureError(error, "Failed to load passkeys");
  }
};
/* eslint-enable functional/no-try-statements, functional/no-promise-reject, functional/no-throw-statements */

/** One of the caller's registered WebAuthn passkeys (the env-vault step-up factor). */
export type UserPasskey = Awaited<ReturnType<typeof loadPasskeys>>[number];

export const authKeyPrefix = ["auth"] as const;

export const sessionQueryOptions = queryOptions({
  queryKey: ["auth", "session"],
  queryFn: loadSession,
  staleTime: Number.POSITIVE_INFINITY,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
});

export const orgsQueryOptions = queryOptions({
  queryKey: ["auth", "orgs"],
  queryFn: loadOrgs,
  staleTime: Number.POSITIVE_INFINITY,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
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

export const passkeysQueryOptions = queryOptions({
  queryKey: ["auth", "passkeys"],
  queryFn: loadPasskeys,
  staleTime: ONE_MINUTE_MS,
});
