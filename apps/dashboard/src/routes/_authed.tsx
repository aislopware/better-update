import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { orgsQueryOptions } from "../queries/auth";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ context }) => {
    if (!context.session?.user) {
      throw redirect({ to: "/login" });
    }

    const orgs = await context.queryClient.ensureQueryData(orgsQueryOptions);

    return { user: context.session.user, orgs };
  },
  component: () => <Outlet />,
});
