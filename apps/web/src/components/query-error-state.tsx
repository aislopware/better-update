import { getApiError, getTypedApiError } from "@better-update/api-client";
import { Button } from "@better-update/ui/components/ui/button";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
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
    <Card>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">{forbidden ? <LockIcon /> : <TriangleAlertIcon />}</EmptyMedia>
          <EmptyTitle>{forbidden ? "You do not have access" : "Something went wrong"}</EmptyTitle>
          <EmptyDescription>
            {forbidden
              ? "You do not have permission to view this content. Ask an organization admin to grant you access."
              : getApiError(error)}
          </EmptyDescription>
        </EmptyHeader>
        {!forbidden && onRetry ? (
          <EmptyContent>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const result = onRetry();
                if (result instanceof Promise) {
                  fireAndForget(result);
                }
              }}
            >
              Try again
            </Button>
          </EmptyContent>
        ) : null}
      </Empty>
    </Card>
  );
};
