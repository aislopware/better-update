import { getApiError, getTypedApiError } from "@better-update/api-client";
import { Button } from "@better-update/ui/components/button";
import { Empty } from "@better-update/ui/components/empty";
import { LockIcon, TriangleAlertIcon } from "lucide-react";

import { fireAndForget } from "../lib/data-table";

interface QueryErrorStateProps {
  readonly error: unknown;
  readonly onRetry?: () => unknown;
}

/**
 * Settled-error surface for in-page queries. Forbidden (403) renders a
 * dead-end access message; every other failure renders the API message with
 * a retry action.
 */
export const QueryErrorState = ({ error, onRetry }: QueryErrorStateProps) => {
  const forbidden = getTypedApiError(error)?._tag === "Forbidden";
  return (
    <Empty
      icon={forbidden ? <LockIcon /> : <TriangleAlertIcon />}
      title={forbidden ? "You do not have access" : "Something went wrong"}
      description={
        forbidden
          ? "You do not have permission to view this content. Ask an organization admin to grant you access."
          : getApiError(error)
      }
      contents={
        !forbidden && onRetry ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              const result = onRetry();
              if (result instanceof Promise) {
                fireAndForget(result);
              }
            }}
          >
            {" "}
            Try again{" "}
          </Button>
        ) : null
      }
    />
  );
};
