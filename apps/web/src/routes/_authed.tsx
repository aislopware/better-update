import { Outlet, createFileRoute, isRedirect, redirect } from "@tanstack/react-router";

import { AppShellSkeleton } from "../components/app-shell-skeleton";
import { ensureError } from "../lib/ensure-error";
import { orgsQueryOptions, sessionQueryOptions } from "../queries/auth";

export const Route = createFileRoute("/_authed")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    /* eslint-disable functional/no-try-statements, functional/no-let, functional/no-throw-statements, functional/no-promise-reject, typescript/only-throw-error, init-declarations -- TanStack Router idiom: beforeLoad must throw redirect Response; defensive try/catch coerces non-Error rejects (e.g. `throw undefined`) into Error/redirect so React error boundaries can render instead of crashing render */
    let session;
    try {
      session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    } catch (error) {
      if (isRedirect(error)) {
        throw error;
      }
      throw redirect({
        to: "/auth/login",
        search: { redirectTo: location.href },
      });
    }
    if (!session?.user) {
      throw redirect({
        to: "/auth/login",
        search: { redirectTo: location.href },
      });
    }
    let orgs;
    try {
      orgs = await context.queryClient.ensureQueryData(orgsQueryOptions);
    } catch (error) {
      if (isRedirect(error)) {
        throw error;
      }
      throw ensureError(error, "Failed to load organizations");
    }
    /* eslint-enable functional/no-try-statements, functional/no-let, functional/no-throw-statements, functional/no-promise-reject, typescript/only-throw-error, init-declarations */
    return { session, user: session.user, orgs };
  },
  // No `pendingMs: 0` here: this layout's beforeLoad is an auth/org redirect
  // guard. Showing the skeleton instantly would let it render while a nested
  // beforeLoad redirect is in flight, triggering a TanStack Router mid-transition
  // throw (the default pending delay lets fast redirects resolve first).
  pendingComponent: AppShellSkeleton,
  component: () => <Outlet />,
});
