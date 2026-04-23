import { Outlet, createFileRoute } from "@tanstack/react-router";

import { GlobalLoading } from "../components/global-loading";
import { sessionQueryOptions } from "../queries/auth";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    return { session };
  },
  pendingComponent: GlobalLoading,
  pendingMs: 0,
  pendingMinMs: 0,
  component: () => <Outlet />,
});
