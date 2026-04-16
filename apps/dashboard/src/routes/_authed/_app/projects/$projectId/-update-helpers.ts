import { buildCompatibilityMatrixQueryKey, updatesQueryKey } from "@better-update/api-client/react";
import { safeJsonParse } from "@better-update/safe-json";
import { Effect } from "effect";

import type { QueryClient } from "@tanstack/react-query";

export const readUpdateEnvironment = (extraJson: string | null | undefined): string | undefined => {
  if (!extraJson) {
    return undefined;
  }
  const parsed = safeJsonParse(extraJson);
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- extraJson is always a JSON object written by our CLI
  const value = (parsed as Record<string, unknown>)["environment"];
  return typeof value === "string" ? value : undefined;
};

export const invalidateUpdates = async (
  queryClient: QueryClient,
  orgId: string,
  projectId: string,
): Promise<void> =>
  Effect.runPromise(
    Effect.asVoid(
      Effect.all(
        [
          Effect.promise(async () =>
            queryClient.invalidateQueries({
              queryKey: updatesQueryKey(orgId, projectId),
            }),
          ),
          Effect.promise(async () =>
            queryClient.invalidateQueries({
              queryKey: buildCompatibilityMatrixQueryKey(orgId, projectId),
            }),
          ),
        ],
        { concurrency: "unbounded" },
      ),
    ),
  );
