import { Outlet, createFileRoute, isRedirect } from "@tanstack/react-router";

import { GlobalLoading } from "../components/global-loading";
import { ensureError } from "../lib/ensure-error";
import { sessionQueryOptions } from "../queries/auth";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async ({ context }) => {
    /* eslint-disable functional/no-try-statements, functional/no-let, functional/no-promise-reject, functional/no-throw-statements, init-declarations -- TanStack Router CatchBoundary uses `if (error)` truthy check that drops `undefined`/`null`/falsy errors; coerce non-Error rejects to a real Error so the boundary can render */
    let session;
    try {
      session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    } catch (error) {
      if (isRedirect(error)) {
        throw error;
      }
      throw ensureError(error, "Failed to load session");
    }
    /* eslint-enable functional/no-try-statements, functional/no-let, functional/no-promise-reject, functional/no-throw-statements, init-declarations */
    return { session };
  },
  pendingComponent: GlobalLoading,
  pendingMs: 0,
  pendingMinMs: 0,
  component: () => <Outlet />,
});
