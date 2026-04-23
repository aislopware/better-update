import { Button } from "@better-update/ui/components/ui/button";
import { Component } from "react";

import type { ReactNode } from "react";

interface ErrorBoundaryProps {
  fallback?: (error: Error, reset: () => void) => ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

const DefaultFallback = ({ error, reset }: { error: Error; reset: () => void }) => (
  <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 py-16">
    <div className="space-y-1">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground text-sm">{error.message}</p>
    </div>
    <Button onClick={reset} variant="outline">
      Try again
    </Button>
  </div>
);

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  public reset = (): void => {
    // eslint-disable-next-line react/no-set-state -- Class error boundary requires setState to clear error; no hook equivalent exists in React 19.
    this.setState({ error: null });
  };

  public override render(): ReactNode {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) {
        return this.props.fallback(error, this.reset);
      }
      return <DefaultFallback error={error} reset={this.reset} />;
    }
    return this.props.children;
  }
}
