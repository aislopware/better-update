import { Outlet, createFileRoute } from "@tanstack/react-router";

import { throwRedirect } from "../lib/throw-redirect";
import { orgsQueryOptions } from "../queries/auth";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ context }) => {
    if (!context.session?.user) {
      throwRedirect({ to: "/login" });
    }

    const orgs = await context.queryClient.ensureQueryData(orgsQueryOptions);

    return { user: context.session.user, orgs };
  },
  component: () => <Outlet />,
});
