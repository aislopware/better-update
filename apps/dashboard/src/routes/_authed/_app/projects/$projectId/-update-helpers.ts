import {
  branchesQueryKey,
  buildCompatibilityMatrixQueryKey,
  buildsQueryKey,
  channelsQueryKey,
  projectQueryKey,
  projectsQueryKey,
  updatesQueryKey,
} from "@better-update/api-client/react";
import { safeJsonParse } from "@better-update/safe-json";
import { Effect } from "effect";

import type { QueryClient, QueryKey } from "@tanstack/react-query";

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

const invalidateAll = async (
  queryClient: QueryClient,
  queryKeys: readonly QueryKey[],
): Promise<void> =>
  Effect.runPromise(
    Effect.asVoid(
      Effect.all(
        queryKeys.map((queryKey) =>
          Effect.promise(async () => queryClient.invalidateQueries({ queryKey })),
        ),
        { concurrency: "unbounded" },
      ),
    ),
  );

export const invalidateUpdates = async (
  queryClient: QueryClient,
  orgId: string,
  projectId: string,
): Promise<void> =>
  invalidateAll(queryClient, [
    updatesQueryKey(orgId, projectId),
    buildCompatibilityMatrixQueryKey(orgId, projectId),
  ]);

export const invalidateChannels = async (
  queryClient: QueryClient,
  orgId: string,
  projectId: string,
): Promise<void> =>
  invalidateAll(queryClient, [
    channelsQueryKey(orgId, projectId),
    buildCompatibilityMatrixQueryKey(orgId, projectId),
  ]);

export const invalidateBuilds = async (
  queryClient: QueryClient,
  orgId: string,
  projectId: string,
): Promise<void> =>
  invalidateAll(queryClient, [
    buildsQueryKey(orgId, projectId),
    buildCompatibilityMatrixQueryKey(orgId, projectId),
  ]);

export const invalidateBranches = async (
  queryClient: QueryClient,
  orgId: string,
  projectId: string,
): Promise<void> =>
  invalidateAll(queryClient, [
    branchesQueryKey(orgId, projectId),
    channelsQueryKey(orgId, projectId),
    updatesQueryKey(orgId, projectId),
    buildCompatibilityMatrixQueryKey(orgId, projectId),
  ]);

export const invalidateProjects = async (
  queryClient: QueryClient,
  orgId: string,
  projectId: string,
): Promise<void> =>
  invalidateAll(queryClient, [projectsQueryKey(orgId), projectQueryKey(orgId, projectId)]);
