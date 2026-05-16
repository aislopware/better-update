import { Button } from "@better-update/ui/components/ui/button";
import { ErrorBoundary as ReactErrorBoundary } from "react-error-boundary";

import type { ReactNode } from "react";
import type { FallbackProps } from "react-error-boundary";

const DefaultFallback = ({ error, resetErrorBoundary }: FallbackProps) => (
  <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 py-16">
    <div className="flex flex-col gap-1">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground text-sm">
        {error instanceof Error ? error.message : String(error)}
      </p>
    </div>
    <Button onClick={resetErrorBoundary} variant="outline">
      Try again
    </Button>
  </div>
);

export const ErrorBoundary = ({ children }: { children: ReactNode }) => (
  <ReactErrorBoundary FallbackComponent={DefaultFallback}>{children}</ReactErrorBoundary>
);
