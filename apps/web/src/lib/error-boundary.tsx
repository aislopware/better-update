import { Button } from "@better-update/ui/components/ui/button";
import { useRouterState } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { ErrorBoundary as ReactErrorBoundary } from "react-error-boundary";

import type { ReactNode } from "react";
import type { FallbackProps } from "react-error-boundary";

// A non-Error thrown value (almost always `undefined`) is usually a transient
// TanStack Router race: the router suspends by throwing a match's
// `loadPromise`, which can already be cleared to `undefined` mid-transition
// (patched in patches/@tanstack%2Freact-router, but other non-Error throws
// can still land here). Instead of rendering nothing forever, give the
// transition a beat to settle and reset the boundary — a bounded number of
// times, so a persistent failure ends at a reload screen, not an invisible
// reset loop.
const MAX_TRANSIENT_RESETS = 3;
const TRANSIENT_RESET_DELAY_MS = 50;

const ErrorScreen = ({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
}) => (
  <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 py-16">
    <div className="flex flex-col gap-1">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground text-sm">{message}</p>
    </div>
    <Button onClick={onAction} variant="outline">
      {actionLabel}
    </Button>
  </div>
);

const DefaultFallback = ({ error, resetErrorBoundary }: FallbackProps) => {
  // Transient non-Error throw: ErrorBoundary below schedules an automatic
  // reset (or swaps to the reload screen once the budget runs out), so render
  // nothing instead of flashing "undefined" at the user.
  if (!(error instanceof Error)) {
    return null;
  }
  return (
    <ErrorScreen actionLabel="Try again" message={error.message} onAction={resetErrorBoundary} />
  );
};

const reloadPage = () => {
  globalThis.location.reload();
};

export const ErrorBoundary = ({ children }: { children: ReactNode }) => {
  const href = useRouterState({ select: (state) => state.location.href });
  const [resetTick, setResetTick] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const transientResets = useRef(0);
  const lastHref = useRef(href);

  // Navigation is the natural recovery point: forget past transient resets.
  if (lastHref.current !== href) {
    lastHref.current = href;
    transientResets.current = 0;
    if (exhausted) {
      setExhausted(false);
    }
  }

  const onCaught = (error: unknown) => {
    if (error instanceof Error) {
      return;
    }
    if (transientResets.current >= MAX_TRANSIENT_RESETS) {
      setExhausted(true);
      return;
    }
    transientResets.current += 1;
    setTimeout(() => {
      setResetTick((tick) => tick + 1);
    }, TRANSIENT_RESET_DELAY_MS);
  };

  return exhausted ? (
    <ErrorScreen
      actionLabel="Reload page"
      message="The page failed to load."
      onAction={reloadPage}
    />
  ) : (
    <ReactErrorBoundary
      FallbackComponent={DefaultFallback}
      onError={onCaught}
      resetKeys={[href, resetTick]}
    >
      {children}
    </ReactErrorBoundary>
  );
};
