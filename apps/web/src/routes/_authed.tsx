import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { AppShellSkeleton } from "../components/app-shell-skeleton";
import { orgsQueryOptions, sessionQueryOptions } from "../queries/auth";

export const Route = createFileRoute("/_authed")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    if (!session?.user) {
      // eslint-disable-next-line functional/no-throw-statements, functional/no-promise-reject, typescript/only-throw-error -- typed search-param inference on /auth/login requires inline redirect; the throwRedirect helper collapses generics
      throw redirect({
        to: "/auth/login",
        search: { redirectTo: location.href },
      });
    }
    const orgs = await context.queryClient.ensureQueryData(orgsQueryOptions);
    return { session, user: session.user, orgs };
  },
  pendingComponent: AppShellSkeleton,
  pendingMs: 0,
  pendingMinMs: 0,
  component: () => <Outlet />,
});
