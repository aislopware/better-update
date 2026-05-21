import { Button } from "@better-update/ui/components/ui/button";
import { useRouterState } from "@tanstack/react-router";
import { ErrorBoundary as ReactErrorBoundary } from "react-error-boundary";

import type { ReactNode } from "react";
import type { FallbackProps } from "react-error-boundary";

const DefaultFallback = ({ error, resetErrorBoundary }: FallbackProps) => {
  // A non-Error thrown value (almost always `undefined`) is not a real failure:
  // TanStack Router suspends by throwing a match's `loadPromise`, and during an
  // in-flight transition that promise can already be cleared to `undefined`
  // (see Match.tsx). The route CatchBoundary skips it (truthy `if (error)`) so it
  // bubbles here. Render nothing and let `resetKeys` (router location) recover the
  // tree once the navigation settles, instead of flashing "undefined" at the user.
  if (!(error instanceof Error)) {
    return null;
  }
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 py-16">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">Something went wrong</h2>
        <p className="text-muted-foreground text-sm">{error.message}</p>
      </div>
      <Button onClick={resetErrorBoundary} variant="outline">
        Try again
      </Button>
    </div>
  );
};

export const ErrorBoundary = ({ children }: { children: ReactNode }) => {
  // Reset the boundary whenever the router location changes so a transient
  // mid-transition throw recovers automatically once navigation settles.
  const href = useRouterState({ select: (state) => state.location.href });
  return (
    <ReactErrorBoundary FallbackComponent={DefaultFallback} resetKeys={[href]}>
      {children}
    </ReactErrorBoundary>
  );
};
