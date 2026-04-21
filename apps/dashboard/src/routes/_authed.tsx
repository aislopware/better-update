import { Outlet, createFileRoute } from "@tanstack/react-router";

import { accountsUrl } from "../lib/accounts-redirect";
import { throwRedirect } from "../lib/throw-redirect";
import { orgsQueryOptions } from "../queries/auth";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ context, location }) => {
    if (!context.session?.user) {
      throwRedirect({
        href: accountsUrl(
          `/login?redirectTo=${encodeURIComponent(globalThis.location.origin + location.href)}`,
        ),
      });
    }

    const orgs = await context.queryClient.ensureQueryData(orgsQueryOptions);

    return { user: context.session.user, orgs };
  },
  component: () => <Outlet />,
});
